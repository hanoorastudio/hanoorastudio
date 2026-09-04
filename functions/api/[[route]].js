/* ============================================================
   Hanoora — CMS + Tim (multi-user) — semua endpoint /api/*
   Bindings: CONTENT (KV), MEDIA (R2)
   Secrets:  DASH_PASSWORD (bootstrap admin), SESSION_SECRET,
             CF_API_TOKEN?, CF_ZONE_TAG? (analytics, opsional)

   Akun disimpan di KV key 'users'; izin di 'leaves'; permintaan
   ganti password di 'pwreqs'. Konten situs di 'site'.
   Bootstrap: kalau belum ada akun, login username "admin" +
   DASH_PASSWORD akan membuat akun admin pertama.
   ============================================================ */

const enc = new TextEncoder();
const COOKIE = 'hsess';
const TTL = 60 * 60 * 12;

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
}

/* ---------- crypto / session ---------- */
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let out = 0; for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i); return out === 0;
}
const b64u = s => btoa(unescape(encodeURIComponent(s))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const ub64u = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

async function issueSession(secret, payload) {
  const p = b64u(JSON.stringify(payload));
  return p + '.' + await hmacHex(secret, p);
}
async function readSession(secret, token) {
  if (!secret || !token || token.indexOf('.') < 0) return null;
  const [p, sig] = token.split('.');
  if (!p || !sig) return null;
  if (!safeEqual(sig, await hmacHex(secret, p))) return null;
  let obj; try { obj = JSON.parse(ub64u(p)); } catch (e) { return null; }
  if (!obj || !obj.exp || obj.exp < Date.now()) return null;
  return obj; // {u, r, exp}
}
function readCookie(request) {
  const raw = request.headers.get('cookie') || '';
  const m = raw.match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  return m ? m[1] : '';
}
async function currentUser(request, env) { return readSession(env.SESSION_SECRET, readCookie(request)); }
const setCookie = t => `${COOKIE}=${t}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TTL}`;
const clrCookie = () => `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

/* ---------- KV helpers ---------- */
async function getJSON(env, key, def) { try { const v = await env.CONTENT.get(key); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
async function putJSON(env, key, val) { await env.CONTENT.put(key, JSON.stringify(val)); }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const lc = s => String(s || '').trim().toLowerCase();

/* ============================================================
   AUTH
   ============================================================ */
async function login(request, env) {
  if (!env.SESSION_SECRET) return json({ ok: false, error: 'SESSION_SECRET belum diatur.' }, 500);
  let body = {}; try { body = await request.json(); } catch (e) {}
  const username = lc(body.username), password = String(body.password || '');
  if (!username || !password) return json({ ok: false, error: 'Isi username & password.' }, 400);

  const users = await getJSON(env, 'users', []);
  if (!users.length) {
    // bootstrap admin pertama
    if (username === 'admin' && env.DASH_PASSWORD && safeEqual(password, String(env.DASH_PASSWORD))) {
      const admin = { username: 'admin', password: String(env.DASH_PASSWORD), role: 'admin', name: 'Admin' };
      await putJSON(env, 'users', [admin]);
      return json({ ok: true, user: { username: 'admin', role: 'admin', name: 'Admin' } }, 200, { 'set-cookie': setCookie(await issueSession(env.SESSION_SECRET, { u: 'admin', r: 'admin', exp: Date.now() + TTL * 1000 })) });
    }
    return json({ ok: false, error: 'Belum ada akun. Login pertama: username "admin" + password bootstrap.' }, 401);
  }
  const u = users.find(x => lc(x.username) === username);
  if (!u || !safeEqual(password, String(u.password))) return json({ ok: false, error: 'Username atau password salah.' }, 401);
  return json({ ok: true, user: { username: u.username, role: u.role, name: u.name || u.username } }, 200,
    { 'set-cookie': setCookie(await issueSession(env.SESSION_SECRET, { u: u.username, r: u.role, exp: Date.now() + TTL * 1000 })) });
}

async function me(request, env) {
  const s = await currentUser(request, env);
  if (!s) return json({ ok: false });
  const users = await getJSON(env, 'users', []);
  const u = users.find(x => lc(x.username) === lc(s.u));
  return json({ ok: true, user: { username: s.u, role: s.r, name: (u && u.name) || s.u } });
}

/* ============================================================
   USERS (admin)
   ============================================================ */
async function usersGet(request, env) {
  const s = await currentUser(request, env);
  if (!s || s.r !== 'admin') return json({ ok: false, error: 'Khusus admin.' }, 403);
  const users = await getJSON(env, 'users', []);
  return json({ ok: true, users });
}
async function usersPost(request, env) {
  const s = await currentUser(request, env);
  if (!s || s.r !== 'admin') return json({ ok: false, error: 'Khusus admin.' }, 403);
  let body = {}; try { body = await request.json(); } catch (e) {}
  const users = await getJSON(env, 'users', []);

  if (body.action === 'save') {
    const u = body.user || {};
    const uname = lc(u.username);
    if (!uname) return json({ ok: false, error: 'Username kosong.' }, 400);
    const idx = users.findIndex(x => lc(x.username) === uname);
    const rec = { username: u.username.trim(), password: String(u.password || ''), role: u.role === 'admin' ? 'admin' : 'member', name: (u.name || u.username).trim() };
    if (idx >= 0) { rec.password = rec.password || users[idx].password; users[idx] = rec; }
    else { if (!rec.password) return json({ ok: false, error: 'Password kosong untuk akun baru.' }, 400); users.push(rec); }
    // jaga minimal 1 admin
    if (!users.some(x => x.role === 'admin')) return json({ ok: false, error: 'Harus ada minimal 1 admin.' }, 400);
    await putJSON(env, 'users', users);
    return json({ ok: true });
  }
  if (body.action === 'delete') {
    const uname = lc(body.username);
    if (uname === lc(s.u)) return json({ ok: false, error: 'Tidak bisa menghapus akun sendiri.' }, 400);
    const left = users.filter(x => lc(x.username) !== uname);
    if (!left.some(x => x.role === 'admin')) return json({ ok: false, error: 'Harus ada minimal 1 admin.' }, 400);
    await putJSON(env, 'users', left);
    return json({ ok: true });
  }
  return json({ ok: false, error: 'Aksi tidak dikenal.' }, 400);
}

/* ============================================================
   PERMINTAAN GANTI PASSWORD
   ============================================================ */
async function pwrequestPost(request, env) { // member minta ganti password sendiri
  const s = await currentUser(request, env);
  if (!s) return json({ ok: false, error: 'Belum login.' }, 401);
  let body = {}; try { body = await request.json(); } catch (e) {}
  const next = String(body.newPassword || '');
  if (next.length < 4) return json({ ok: false, error: 'Password baru minimal 4 karakter.' }, 400);
  const reqs = await getJSON(env, 'pwreqs', []);
  // hapus permintaan lama dari user yang sama yang masih pending
  const filtered = reqs.filter(r => !(lc(r.username) === lc(s.u) && r.status === 'pending'));
  filtered.push({ id: uid(), username: s.u, newPassword: next, status: 'pending', createdAt: new Date().toISOString() });
  await putJSON(env, 'pwreqs', filtered);
  return json({ ok: true });
}
async function pwreqsGet(request, env) { // admin lihat pending
  const s = await currentUser(request, env);
  if (!s || s.r !== 'admin') return json({ ok: false, error: 'Khusus admin.' }, 403);
  const reqs = await getJSON(env, 'pwreqs', []);
  return json({ ok: true, requests: reqs.filter(r => r.status === 'pending') });
}
async function pwreqsPost(request, env) { // admin approve/reject
  const s = await currentUser(request, env);
  if (!s || s.r !== 'admin') return json({ ok: false, error: 'Khusus admin.' }, 403);
  let body = {}; try { body = await request.json(); } catch (e) {}
  const reqs = await getJSON(env, 'pwreqs', []);
  const r = reqs.find(x => x.id === body.id && x.status === 'pending');
  if (!r) return json({ ok: false, error: 'Permintaan tidak ditemukan.' }, 404);
  if (body.action === 'approve') {
    const users = await getJSON(env, 'users', []);
    const u = users.find(x => lc(x.username) === lc(r.username));
    if (u) { u.password = r.newPassword; await putJSON(env, 'users', users); }
    r.status = 'approved';
  } else { r.status = 'rejected'; }
  r.decidedAt = new Date().toISOString();
  // simpan hanya yang pending + yang barusan diputuskan (buang histori lama)
  const keep = reqs.filter(x => x.status === 'pending' || x.id === r.id);
  await putJSON(env, 'pwreqs', keep);
  return json({ ok: true });
}

/* ============================================================
   IZIN / WFH
   ============================================================ */
async function leavesGet(request, env) {
  const s = await currentUser(request, env);
  if (!s) return json({ ok: false, error: 'Belum login.' }, 401);
  let list = await getJSON(env, 'leaves', []);
  if (s.r !== 'admin') list = list.filter(x => lc(x.username) === lc(s.u));
  list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return json({ ok: true, leaves: list });
}
async function leavesPost(request, env) {
  const s = await currentUser(request, env);
  if (!s) return json({ ok: false, error: 'Belum login.' }, 401);
  let body = {}; try { body = await request.json(); } catch (e) {}
  const type = body.type === 'wfh' ? 'wfh' : 'izin';
  const from = String(body.from || ''), to = String(body.to || from);
  if (!from) return json({ ok: false, error: 'Tanggal mulai wajib diisi.' }, 400);
  const list = await getJSON(env, 'leaves', []);
  list.push({ id: uid(), username: s.u, type, from, to, reason: String(body.reason || '').slice(0, 500), createdAt: new Date().toISOString() });
  await putJSON(env, 'leaves', list);
  return json({ ok: true });
}

/* ============================================================
   KONTEN SITUS
   ============================================================ */
async function getContent(env) {
  let raw = '{}'; try { raw = (await env.CONTENT.get('site')) || '{}'; } catch (e) {}
  return new Response(raw, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=30' } });
}
async function saveContent(request, env) {
  const s = await currentUser(request, env);
  if (!s) return json({ ok: false, error: 'Belum login.' }, 401);
  let data; try { data = await request.json(); } catch (e) { return json({ ok: false, error: 'JSON tidak valid.' }, 400); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return json({ ok: false, error: 'Format salah.' }, 400);
  data.works = Array.isArray(data.works) ? data.works : [];
  data.landscape = Array.isArray(data.landscape) ? data.landscape : [];
  data.stills = Array.isArray(data.stills) ? data.stills : [];
  data.contact = (data.contact && typeof data.contact === 'object') ? data.contact : {};
  data.prices = (data.prices && typeof data.prices === 'object') ? data.prices : {};
  data.updatedAt = new Date().toISOString(); data.updatedBy = s.u;
  const prev = await env.CONTENT.get('site'); if (prev) await env.CONTENT.put('site_prev', prev);
  await env.CONTENT.put('site', JSON.stringify(data));
  return json({ ok: true, updatedAt: data.updatedAt });
}
async function backup(request, env) {
  const s = await currentUser(request, env);
  if (!s) return json({ ok: false, error: 'Belum login.' }, 401);
  const raw = (await env.CONTENT.get('site')) || '{}';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return new Response(raw, { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="hanoora-content-${stamp}.json"`, 'cache-control': 'no-store' } });
}

const MAX = 90 * 1024 * 1024;
const OK_TYPES = /^(image\/(jpe?g|png|webp|gif)|video\/(mp4|webm|quicktime))$/i;
const cleanName = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').replace(/\.+/g, '.');
async function upload(request, env) {
  const s = await currentUser(request, env);
  if (!s) return json({ ok: false, error: 'Belum login.' }, 401);
  if (!env.MEDIA) return json({ ok: false, error: 'Bucket R2 (MEDIA) belum di-bind.' }, 500);
  let form; try { form = await request.formData(); } catch (e) { return json({ ok: false, error: 'Bukan form-data.' }, 400); }
  const file = form.get('file');
  if (!file || typeof file === 'string') return json({ ok: false, error: 'File tidak ada.' }, 400);
  if (file.size > MAX) return json({ ok: false, error: 'File terlalu besar (maks 90 MB).' }, 413);
  const type = file.type || '';
  if (!OK_TYPES.test(type)) return json({ ok: false, error: 'Tipe tidak didukung: ' + type }, 415);
  let folder = cleanName(form.get('folder') || (type.startsWith('video') ? 'video' : 'img'));
  if (!['video', 'img', 'logo', 'hero'].includes(folder)) folder = type.startsWith('video') ? 'video' : 'img';
  const key = `${folder}/${cleanName(form.get('name') || file.name || 'file')}`;
  try { await env.MEDIA.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: type } }); }
  catch (e) { return json({ ok: false, error: 'Gagal upload R2: ' + e.message }, 500); }
  return json({ ok: true, key, url: '/media/' + key });
}

const ymd = d => d.toISOString().slice(0, 10);
async function analytics(request, env) {
  const s = await currentUser(request, env);
  if (!s) return json({ ok: false, error: 'Belum login.' }, 401);
  if (!env.CF_API_TOKEN || !env.CF_ZONE_TAG) return json({ ok: true, enabled: false });
  const url = new URL(request.url);
  const range = Math.min(90, Math.max(1, parseInt(url.searchParams.get('range') || '7', 10)));
  const until = new Date(), since = new Date(Date.now() - (range - 1) * 86400000);
  const query = `query ($zone:String!,$since:Date!,$until:Date!){viewer{zones(filter:{zoneTag:$zone}){httpRequests1dGroups(limit:90,filter:{date_geq:$since,date_leq:$until},orderBy:[date_ASC]){dimensions{date} sum{pageViews requests countryMap{clientCountryName requests}} uniq{uniques}}}}}`;
  let res;
  try { res = await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: { authorization: 'Bearer ' + env.CF_API_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables: { zone: env.CF_ZONE_TAG, since: ymd(since), until: ymd(until) } }) }); }
  catch (e) { return json({ ok: true, enabled: true, error: 'Gagal menghubungi Cloudflare: ' + e.message }); }
  const data = await res.json().catch(() => ({}));
  if (data.errors && data.errors.length) return json({ ok: true, enabled: true, error: data.errors.map(e => e.message).join('; ') });
  const groups = data?.data?.viewer?.zones?.[0]?.httpRequests1dGroups || [];
  const series = groups.map(g => ({ date: g.dimensions.date, pageViews: g.sum?.pageViews || 0, uniques: g.uniq?.uniques || 0, requests: g.sum?.requests || 0 }));
  const totals = series.reduce((a, x) => ({ pageViews: a.pageViews + x.pageViews, uniques: a.uniques + x.uniques, requests: a.requests + x.requests }), { pageViews: 0, uniques: 0, requests: 0 });
  const cmap = {}; groups.forEach(g => (g.sum?.countryMap || []).forEach(c => { cmap[c.clientCountryName] = (cmap[c.clientCountryName] || 0) + (c.requests || 0); }));
  const countries = Object.entries(cmap).map(([name, requests]) => ({ name, requests })).sort((a, b) => b.requests - a.requests).slice(0, 8);
  return json({ ok: true, enabled: true, range, series, totals, countries });
}

/* ============================================================
   ROUTER
   ============================================================ */
export async function onRequest(context) {
  const { request, env, params } = context;
  const seg = Array.isArray(params.route) ? params.route : [params.route].filter(Boolean);
  const route = (seg[0] || '').toLowerCase();
  const m = request.method.toUpperCase();
  try {
    if (route === 'content' && m === 'GET') return await getContent(env);
    if (route === 'login' && m === 'POST') return await login(request, env);
    if (route === 'logout' && m === 'POST') return json({ ok: true }, 200, { 'set-cookie': clrCookie() });
    if (route === 'me' && m === 'GET') return await me(request, env);
    if (route === 'save' && m === 'POST') return await saveContent(request, env);
    if (route === 'backup' && m === 'GET') return await backup(request, env);
    if (route === 'upload' && m === 'POST') return await upload(request, env);
    if (route === 'analytics' && m === 'GET') return await analytics(request, env);
    if (route === 'users' && m === 'GET') return await usersGet(request, env);
    if (route === 'users' && m === 'POST') return await usersPost(request, env);
    if (route === 'pwrequest' && m === 'POST') return await pwrequestPost(request, env);
    if (route === 'pwreqs' && m === 'GET') return await pwreqsGet(request, env);
    if (route === 'pwreqs' && m === 'POST') return await pwreqsPost(request, env);
    if (route === 'leaves' && m === 'GET') return await leavesGet(request, env);
    if (route === 'leaves' && m === 'POST') return await leavesPost(request, env);
    return json({ ok: false, error: 'Endpoint tidak ditemukan: ' + route }, 404);
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
