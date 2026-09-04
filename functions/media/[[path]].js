/* GET /media/<key> — sajikan file dari R2 (binding MEDIA). Publik. */
export async function onRequestGet({ params, env }) {
  if (!env.MEDIA) return new Response('R2 not bound', { status: 500 });
  const key = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '');
  if (!key || key.includes('..')) return new Response('Bad key', { status: 400 });
  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=86400');
  return new Response(obj.body, { headers });
}
