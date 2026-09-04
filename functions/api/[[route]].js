/* ============================================================
   Hanoora CMS — semua endpoint /api/* dalam satu file.
   Routes: content, login, logout, me, save, backup, upload, analytics
   Bindings: CONTENT (KV), MEDIA (R2)
   Secrets:  DASH_PASSWORD, SESSION_SECRET, CF_API_TOKEN?, CF_ZONE_TAG?
   ============================================================ */

const enc = new TextEncoder();
const COOKIE = 'hsess';
const TTL = 60 * 60 * 12; // 12 jam

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

/* ---------- auth ---------- */
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
async function issueSession(secret) {
  const exp = Date.now() + TTL * 1000;
  return `${exp}.${await hmacHex(secret, String(exp))}`;
}
async function verifySession(secret, token) {
  if (!token || token.indexOf('.') < 0) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmacHex(secret, exp));
}
function readCookie(request) {
  const raw = request.headers.get('cookie') || '';
  const m = raw.match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  return m ? m[1] : '';
}
async function requireAuth(request, env) {
  if (!env.SESSION_SECRET) return false;
  return verifySession(env.SESSION_SECRET, readCookie(request));
}
const setCookie = t => `${COOKIE}=${t}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TTL}`;
const clrCookie = () => `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

/* ---------- handlers ---------- */
async function getContent(env) {
  let raw = '{}';
  try { raw = (await env.CONTENT.get('site')) || '{}'; } catch (e) {}
  return new Response(raw, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=30' } });
}

async function login(request, env) {
  if (!env.DASH_PASSWORD || !env.SESSION_SECRET) return json({ ok: false, error: 'Server belum dikonfigurasi (DASH_PASSWORD / SESSION_SECRET).' }, 500);
  let body = {}; try { body = await request.json(); } catch (e) {}
  if (!safeEqual(String(body.password || ''), String(env.DASH_PASSWORD))) return json({ ok: false, error: 'Password salah.' }, 401);
  return json({ ok: true }, 200, { 'set-cookie': setCookie(await issueSession(env.SESSION_SECRET)) });
}

async function save(request, env) {
  if (!(await requireAuth(request, env))) return json({ ok: false, error: 'Belum login.' }, 401);
  let data; try { data = await request.json(); } catch (e) { return json({ ok: false, error: 'JSON tidak valid.' }, 400); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return json({ ok: false, error: 'Format salah.' }, 400);
  data.works = Array.isArray(data.works) ? data.works : [];
  data.gallery = Array.isArray(data.gallery) ? data.gallery : [];
  data.contact = (data.contact && typeof data.contact === 'object') ? data.contact : {};
  data.prices = (data.prices && typeof data.prices === 'object') ? data.prices : {};
  data.updatedAt = new Date().toISOString();
  try {
    const prev = await env.CONTENT.get('site');
    if (prev) await env.CONTENT.put('site_prev', prev);
    await env.CONTENT.put('site', JSON.stringify(data));
  } catch (e) { return json({ ok: false, error: 'Gagal menulis KV: ' + e.message }, 500); }
  return json({ ok: true, updatedAt: data.updatedAt });
}

async function backup(request, env) {
  if (!(await requireAuth(request, env))) return json({ ok: false, error: 'Belum login.' }, 401);
  const raw = (await env.CONTENT.get('site')) || '{}';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return new Response(raw, { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="hanoora-content-${stamp}.json"`, 'cache-control': 'no-store' } });
}

const MAX = 90 * 1024 * 1024;
const OK_TYPES = /^(image\/(jpe?g|png|webp|gif)|video\/(mp4|webm|quicktime))$/i;
const cleanName = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').replace(/\.+/g, '.');

async function upload(request, env) {
  if (!(await requireAuth(request, env))) return json({ ok: false, error: 'Belum login.' }, 401);
  if (!env.MEDIA) return json({ ok: false, error: 'Bucket R2 (MEDIA) belum di-bind.' }, 500);
  let form; try { form = await request.formData(); } catch (e) { return json({ ok: false, error: 'Bukan form-data.' }, 400); }
  const file = form.get('file');
  if (!file || typeof file === 'string') return json({ ok: false, error: 'File tidak ada.' }, 400);
  if (file.size > MAX) return json({ ok: false, error: 'File terlalu besar (maks 90 MB).' }, 413);
  const type = file.type || 'application/octet-stream';
  if (!OK_TYPES.test(type)) return json({ ok: false, error: 'Tipe tidak didukung: ' + type }, 415);
  let folder = cleanName(form.get('folder') || (type.startsWith('video') ? 'video' : 'img'));
  if (!['video', 'img', 'logo', 'hero'].includes(folder)) folder = type.startsWith('video') ? 'video' : 'img';
  const key = `${folder}/${cleanName(form.get('name') || file.name || 'file')}`;
  try { await env.MEDIA.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: type } }); }
  catch (e) { return json({ ok: false, error: 'Gagal upload R2: ' + e.message }, 500); }
  return json({ ok: true, key, url: '/media/' + key, type, size: file.size });
}

const ymd = d => d.toISOString().slice(0, 10);
async function analytics(request, env) {
  if (!(await requireAuth(request, env))) return json({ ok: false, error: 'Belum login.' }, 401);
  if (!env.CF_API_TOKEN || !env.CF_ZONE_TAG) return json({ ok: true, enabled: false, reason: 'CF_API_TOKEN / CF_ZONE_TAG belum diatur.' });
  const url = new URL(request.url);
  const range = Math.min(90, Math.max(1, parseInt(url.searchParams.get('range') || '7', 10)));
  const until = new Date(), since = new Date(Date.now() - (range - 1) * 86400000);
  const query = `query ($zone:String!,$since:Date!,$until:Date!){viewer{zones(filter:{zoneTag:$zone}){httpRequests1dGroups(limit:90,filter:{date_geq:$since,date_leq:$until},orderBy:[date_ASC]){dimensions{date} sum{pageViews requests countryMap{clientCountryName requests}} uniq{uniques}}}}}`;
  let res;
  try {
    res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + env.CF_API_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { zone: env.CF_ZONE_TAG, since: ymd(since), until: ymd(until) } }),
    });
  } catch (e) { return json({ ok: true, enabled: true, error: 'Gagal menghubungi Cloudflare: ' + e.message }); }
  const data = await res.json().catch(() => ({}));
  if (data.errors && data.errors.length) return json({ ok: true, enabled: true, error: data.errors.map(e => e.message).join('; ') });
  const groups = data?.data?.viewer?.zones?.[0]?.httpRequests1dGroups || [];
  const series = groups.map(g => ({ date: g.dimensions.date, pageViews: g.sum?.pageViews || 0, uniques: g.uniq?.uniques || 0, requests: g.sum?.requests || 0 }));
  const totals = series.reduce((a, s) => ({ pageViews: a.pageViews + s.pageViews, uniques: a.uniques + s.uniques, requests: a.requests + s.requests }), { pageViews: 0, uniques: 0, requests: 0 });
  const cmap = {};
  groups.forEach(g => (g.sum?.countryMap || []).forEach(c => { cmap[c.clientCountryName] = (cmap[c.clientCountryName] || 0) + (c.requests || 0); }));
  const countries = Object.entries(cmap).map(([name, requests]) => ({ name, requests })).sort((a, b) => b.requests - a.requests).slice(0, 8);
  return json({ ok: true, enabled: true, range, series, totals, countries });
}

/* ---------- router ---------- */
export async function onRequest(context) {
  const { request, env, params } = context;
  const seg = Array.isArray(params.route) ? params.route : [params.route].filter(Boolean);
  const route = (seg[0] || '').toLowerCase();
  const method = request.method.toUpperCase();
  try {
    if (route === 'content' && method === 'GET') return await getContent(env);
    if (route === 'login' && method === 'POST') return await login(request, env);
    if (route === 'logout' && method === 'POST') return json({ ok: true }, 200, { 'set-cookie': clrCookie() });
    if (route === 'me' && method === 'GET') return json({ ok: await requireAuth(request, env) });
    if (route === 'save' && method === 'POST') return await save(request, env);
    if (route === 'backup' && method === 'GET') return await backup(request, env);
    if (route === 'upload' && method === 'POST') return await upload(request, env);
    if (route === 'analytics' && method === 'GET') return await analytics(request, env);
    return json({ ok: false, error: 'Endpoint tidak ditemukan: ' + route }, 404);
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
