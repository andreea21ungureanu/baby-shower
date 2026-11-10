// Fetches a product page and extracts Open Graph / meta data for a preview card.
const dns = require('dns').promises;
const net = require('net');

const decodeEntities = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .trim();

function metaTags(html) {
  const tags = {};
  const re = /<meta\s+[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const attr = (name) => {
      const r = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
      return r ? r[2] ?? r[3] : null;
    };
    const key = (attr('property') || attr('name') || attr('itemprop') || '').toLowerCase();
    const content = attr('content');
    if (key && content != null && !(key in tags)) tags[key] = decodeEntities(content);
  }
  return tags;
}

function jsonLdProduct(html) {
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const data = JSON.parse(m[1].trim());
      const nodes = [].concat(data, data['@graph'] || []).flat();
      for (const n of nodes) {
        const type = [].concat(n && n['@type']).join(' ');
        if (/Product/i.test(type)) {
          const offer = [].concat(n.offers || [])[0] || {};
          const price = offer.price ?? offer.lowPrice ?? (offer.priceSpecification || {}).price;
          return {
            title: n.name,
            description: n.description,
            image: [].concat(n.image || [])[0]?.url || [].concat(n.image || [])[0],
            price: price != null ? Number(price) : null,
          };
        }
      }
    } catch (_) { /* ignore malformed JSON-LD */ }
  }
  return {};
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const v = ip.toLowerCase();
  return v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.');
}

async function assertPublicUrl(url) {
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http(s) links are supported');
  if (process.env.ALLOW_PRIVATE_PREVIEWS === '1') return;
  const { address } = await dns.lookup(url.hostname);
  if (isPrivateAddress(address)) throw new Error('That address is not allowed');
}

async function fetchPreview(rawUrl) {
  const url = new URL(rawUrl);
  await assertPublicUrl(url);

  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; BabyShowerRegistry/1.0; +link-preview)',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-GB,en;q=0.9',
    },
  });

  // Read at most ~1.5MB; meta tags live in the <head>.
  const reader = res.body.getReader();
  let html = '';
  const decoder = new TextDecoder();
  while (html.length < 1_500_000) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});

  const meta = metaTags(html);
  const ld = jsonLdProduct(html);
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const finalUrl = new URL(res.url || url);

  let image = meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || ld.image || null;
  if (image) {
    try { image = new URL(image, finalUrl).href; } catch (_) { image = null; }
  }

  const priceRaw = meta['product:price:amount'] || meta['og:price:amount'] || meta['price'] || ld.price;
  const price = priceRaw != null && !Number.isNaN(parseFloat(priceRaw)) ? parseFloat(String(priceRaw).replace(/,/g, '')) : null;

  return {
    url: finalUrl.href,
    title: meta['og:title'] || meta['twitter:title'] || ld.title || (titleTag ? decodeEntities(titleTag[1]) : '') || finalUrl.hostname,
    description: meta['og:description'] || meta['twitter:description'] || meta['description'] || ld.description || '',
    image,
    siteName: meta['og:site_name'] || finalUrl.hostname.replace(/^www\./, ''),
    price,
  };
}

module.exports = { fetchPreview, metaTags, jsonLdProduct };
