// Bewaart de hele lijst (kamers, meubels, links) als één JSON-document in Cloudflare KV.
const HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

export async function onRequestGet({ env }) {
  const v = await env.STORE.get('data');
  return new Response(v || '{"nodes":[],"links":[]}', { headers: HEADERS });
}

export async function onRequestPut({ request, env }) {
  const text = await request.text();
  if (text.length > 20000000) return new Response('{"error":"te groot"}', { status: 413, headers: HEADERS });
  let d;
  try { d = JSON.parse(text); } catch (e) { return new Response('{"error":"geen json"}', { status: 400, headers: HEADERS }); }
  if (!d || !Array.isArray(d.nodes) || !Array.isArray(d.links)) {
    return new Response('{"error":"verkeerd formaat"}', { status: 400, headers: HEADERS });
  }
  await env.STORE.put('data', text);
  return new Response('{"ok":true}', { headers: HEADERS });
}
