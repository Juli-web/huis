// Leest de prijs van een productpagina. De pagina wordt hier (op de server) opgehaald,
// want een browser mag dat niet bij andere websites. Zoekt in de gegevens die winkels
// voor Google op hun pagina zetten (schema.org, Open Graph). Lukt het niet, dan komt er geen prijs terug.
const HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const out = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: HEADERS });

function allowedUrl(raw) {
  let u;
  try { u = new URL(raw); } catch (e) { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.indexOf('.') === -1) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.indexOf(':') !== -1 || h.charAt(0) === '[') return null;
  return u;
}

// "129.95" -> "129,95", "1.299,00" -> "1299", 129 -> "129"
function formatPrice(v) {
  let s = String(v).trim().replace(/[^\d.,]/g, '');
  if (!s) return '';
  const lastC = s.lastIndexOf(',');
  const lastD = s.lastIndexOf('.');
  if (lastC !== -1 && lastD !== -1) {
    s = lastC > lastD ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastC !== -1) {
    s = /,\d{3}$/.test(s) && s.indexOf(',') === lastC && s.length > 4 ? s.replace(',', '') : s.replace(',', '.');
  } else if (lastD !== -1 && /\.\d{3}$/.test(s) && s.indexOf('.') === lastD) {
    s = s.replace('.', '');
  }
  const n = parseFloat(s);
  if (!isFinite(n) || n <= 0 || n > 1000000) return '';
  const fixed = n % 1 === 0 ? String(n) : n.toFixed(2);
  return fixed.replace('.', ',');
}

function fromOffer(o, depth) {
  if (!o || typeof o !== 'object' || depth > 4) return null;
  if (Array.isArray(o)) {
    for (let i = 0; i < o.length; i++) { const r = fromOffer(o[i], depth + 1); if (r) return r; }
    return null;
  }
  const direct = o.price !== undefined ? o.price : (o.lowPrice !== undefined ? o.lowPrice : null);
  if (direct !== null && direct !== '') return { value: direct, currency: o.priceCurrency || '' };
  if (o.priceSpecification) {
    const r = fromOffer(o.priceSpecification, depth + 1);
    if (r) return { value: r.value, currency: r.currency || o.priceCurrency || '' };
  }
  if (o.offers) return fromOffer(o.offers, depth + 1);
  return null;
}

function walk(node, depth) {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) { const r = walk(node[i], depth + 1); if (r) return r; }
    return null;
  }
  const t = node['@type'];
  const types = Array.isArray(t) ? t : [t];
  if (types.indexOf('Product') !== -1 || types.indexOf('ProductGroup') !== -1 || node.offers) {
    const r = fromOffer(node.offers || node, 0);
    if (r) return r;
  }
  if (node['@graph']) { const r = walk(node['@graph'], depth + 1); if (r) return r; }
  if (node.hasVariant) { const r = walk(node.hasVariant, depth + 1); if (r) return r; }
  return null;
}

function parsePrice(html) {
  // 1. schema.org in JSON-LD
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const r = walk(JSON.parse(m[1].trim()), 0);
      if (r) { const p = formatPrice(r.value); if (p) return { price: p, currency: r.currency, source: 'schema' }; }
    } catch (e) { /* volgende blok */ }
  }
  // 2. meta-tags (Open Graph / product)
  const metas = [
    /<meta[^>]+(?:property|name)=["'](?:product:price:amount|og:price:amount)["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:product:price:amount|og:price:amount)["']/i,
    /<meta[^>]+itemprop=["']price["'][^>]*content=["']([^"']+)["']/i,
    /<[^>]+itemprop=["']price["'][^>]*content=["']([^"']+)["']/i
  ];
  for (let i = 0; i < metas.length; i++) {
    const mm = html.match(metas[i]);
    if (mm) {
      const p = formatPrice(mm[1]);
      if (p) {
        const cur = html.match(/<meta[^>]+(?:property|name)=["'](?:product:price:currency|og:price:currency)["'][^>]*content=["']([^"']+)["']/i);
        return { price: p, currency: cur ? cur[1] : '', source: 'meta' };
      }
    }
  }
  return null;
}

export async function onRequestGet({ request }) {
  const target = allowedUrl(new URL(request.url).searchParams.get('url') || '');
  if (!target) return out({ price: null, error: 'ongeldige link' }, 400);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 7000);
  try {
    const res = await fetch(target.href, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml',
        'accept-language': 'nl-NL,nl;q=0.9,en;q=0.5'
      }
    });
    if (!res.ok) return out({ price: null, error: 'pagina niet bereikbaar (' + res.status + ')' });
    const type = res.headers.get('content-type') || '';
    if (type.indexOf('html') === -1) return out({ price: null, error: 'geen webpagina' });
    const html = (await res.text()).slice(0, 2000000);
    const found = parsePrice(html);
    if (!found) return out({ price: null, error: 'geen prijs gevonden' });
    const cur = (found.currency || 'EUR').toUpperCase();
    return out({ price: cur === 'EUR' ? found.price : cur + ' ' + found.price, source: found.source });
  } catch (e) {
    return out({ price: null, error: 'ophalen mislukt' });
  } finally {
    clearTimeout(timer);
  }
}
