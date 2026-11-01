const CATALOG_URL = 'https://ogckart-sn1.atlas.vegvesen.no/ogc/features/v1/collections/datex_3_1:CctvSimple/items?f=application/geo%2Bjson&limit=5000';
const IMAGE_ORIGIN = 'https://kamera.atlas.vegvesen.no/api/images/';
const CATALOG_LIMIT = 4 * 1024 * 1024;
const IMAGE_LIMIT = 4 * 1024 * 1024;
const CATALOG_TTL = 60;
const IMAGE_TTL = 10;

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
    ...extra
  };
}

function json(payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: corsHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra
    })
  });
}

async function readLimited(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error('Upstream supera el límite permitido');
  if (!response.body) throw new Error('Respuesta upstream vacía');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Respuesta upstream supera el límite permitido');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function cachedFetch(cacheKey, ttl, fetcher) {
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  const response = await fetcher();
  if (response.ok) {
    const copy = response.clone();
    copy.headers.set('Cache-Control', `public, max-age=${ttl}`);
    await cache.put(cacheKey, copy);
  }
  return response;
}

async function getCatalog(request) {
  const cacheKey = new Request(new URL('/__cache/cctv-catalog-v1', request.url));
  return cachedFetch(cacheKey, CATALOG_TTL, async () => {
    const upstream = await fetch(CATALOG_URL, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'Accept': 'application/geo+json,application/json',
        'User-Agent': 'OjoDeDios-CCTV/2.0 public road camera viewer'
      }
    });
    if (upstream.status >= 300 && upstream.status < 400) return json({ error: 'Redirección de catálogo rechazada' }, 502);
    if (!upstream.ok) return json({ error: `Catálogo oficial HTTP ${upstream.status}` }, 502);
    const bytes = await readLimited(upstream, CATALOG_LIMIT);
    const data = JSON.parse(new TextDecoder().decode(bytes));
    const features = Array.isArray(data?.features) ? data.features : [];
    const cameras = [];
    const seen = new Set();
    for (const feature of features) {
      const props = feature?.properties || {};
      const coords = feature?.geometry?.coordinates;
      const id = String(props.cameraId || '').trim();
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || seen.has(id.toLowerCase())) continue;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const lon = Number(coords[0]);
      const lat = Number(coords[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 57 || lat > 72 || lon < 3 || lon > 32) continue;
      const availability = String(props['status.stillImageAvailability'] || '');
      if (availability && availability !== 'videoOrImagesAvailable') continue;
      const expectedImage = IMAGE_ORIGIN + id;
      if (String(props.stillImageUrl || '') !== expectedImage) continue;
      seen.add(id.toLowerCase());
      cameras.push({
        id: `no-vegvesen-${id.toLowerCase()}`,
        title: [props.roadNumber, props.description, props.orientationDescription].filter(Boolean).join(' · ') || 'Cámara vial de Noruega',
        lat,
        lon,
        heading: 0,
        region: 'NO',
        sourceId: 'no-vegvesen',
        sourceName: 'Statens vegvesen · Noruega',
        license: 'NLOD 2.0 · Statens vegvesen',
        licenseStatus: 'verified',
        frameUrl: new URL(`/api/cctv-frame/${encodeURIComponent(id)}`, request.url).toString()
      });
    }
    return new Response(JSON.stringify({
      updatedAt: new Date().toISOString(),
      cameras,
      sources: [{
        id: 'no-vegvesen',
        name: 'Statens vegvesen · Noruega',
        region: 'NO',
        status: cameras.length ? 'ok' : 'empty',
        count: cameras.length,
        message: '',
        license: 'NLOD 2.0'
      }]
    }), {
      status: 200,
      headers: corsHeaders({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${CATALOG_TTL}`
      })
    });
  });
}

async function getFrame(request, rawId) {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(rawId)) return json({ error: 'ID de cámara inválido' }, 400);
  const upstreamUrl = IMAGE_ORIGIN + rawId;
  const cacheKey = new Request(new URL(`/__cache/cctv-frame/${encodeURIComponent(rawId)}`, request.url));
  return cachedFetch(cacheKey, IMAGE_TTL, async () => {
    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'Accept': 'image/jpeg,image/png,image/webp', 'User-Agent': 'OjoDeDios-CCTV/2.0' }
    });
    if (upstream.status >= 300 && upstream.status < 400) return json({ error: 'Redirección de imagen rechazada' }, 502);
    if (!upstream.ok) return json({ error: `Imagen oficial HTTP ${upstream.status}` }, 502);
    const type = String(upstream.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return json({ error: 'Tipo de imagen no permitido' }, 502);
    const bytes = await readLimited(upstream, IMAGE_LIMIT);
    return new Response(bytes, {
      status: 200,
      headers: corsHeaders({
        'Content-Type': type,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': `public, max-age=${IMAGE_TTL}`
      })
    });
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
    if (request.method !== 'GET') return json({ error: 'Método no permitido' }, 405);
    try {
      if (url.pathname === '/api/cctv/catalog') return await getCatalog(request);
      const match = /^\/api\/cctv-frame\/([^/]+)$/.exec(url.pathname);
      if (match) return await getFrame(request, decodeURIComponent(match[1]));
      if (url.pathname === '/health') return json({ service: 'ojo-de-dios-cctv', status: 'ok' });
      return json({ error: 'Ruta no encontrada' }, 404);
    } catch (error) {
      return json({ error: error?.message || 'Error de proxy CCTV' }, 502);
    }
  }
};
