const NORWAY_CATALOG = 'https://ogckart-sn1.atlas.vegvesen.no/ogc/features/v1/collections/datex_3_1:CctvSimple/items?f=application/geo%2Bjson&limit=5000';
const NORWAY_IMAGE_ORIGIN = 'https://kamera.atlas.vegvesen.no/api/images/';
const TFL_CATALOG = 'https://api.tfl.gov.uk/Place/Type/JamCam';
const TFL_IMAGE_ORIGIN = 'https://s3-eu-west-1.amazonaws.com';
const FINLAND_CATALOG = 'https://tie.digitraffic.fi/api/weathercam/v1/stations';
const FINLAND_IMAGE_ORIGIN = 'https://weathercam.digitraffic.fi/';
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

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      'Accept': 'application/json,application/geo+json',
      'User-Agent': 'OjoDeDios-CCTV/2.0 public camera viewer',
      ...headers
    }
  });
  if (response.status >= 300 && response.status < 400) throw new Error('Redirección upstream rechazada');
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  return JSON.parse(new TextDecoder().decode(await readLimited(response, CATALOG_LIMIT)));
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

function addCamera(list, camera) {
  if (camera && Number.isFinite(camera.lat) && Number.isFinite(camera.lon)) list.push(camera);
}

async function getCatalog(request) {
  const cacheKey = new Request(new URL('/__cache/cctv-catalog-v2', request.url));
  return cachedFetch(cacheKey, CATALOG_TTL, async () => {
    const results = await Promise.allSettled([
      fetchJson(NORWAY_CATALOG),
      fetchJson(TFL_CATALOG),
      fetchJson(FINLAND_CATALOG, { 'Digitraffic-User': 'Ojo de Dios 2.0' })
    ]);
    const cameras = [];
    const sources = [];
    const frameMaps = [];
    const origin = new URL(request.url).origin;

    // Norway — Statens vegvesen, NLOD 2.0.
    if (results[0].status === 'fulfilled') {
      const features = Array.isArray(results[0].value?.features) ? results[0].value.features : [];
      let count = 0;
      for (const feature of features) {
        const props = feature?.properties || {};
        const coords = feature?.geometry?.coordinates;
        const rawId = String(props.cameraId || '').trim();
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(rawId) || !Array.isArray(coords) || coords.length < 2) continue;
        const lon = Number(coords[0]);
        const lat = Number(coords[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 57 || lat > 72 || lon < 3 || lon > 32) continue;
        const availability = String(props['status.stillImageAvailability'] || '');
        if (availability && availability !== 'videoOrImagesAvailable') continue;
        if (String(props.stillImageUrl || '') !== NORWAY_IMAGE_ORIGIN + rawId) continue;
        const id = `no-vegvesen-${rawId.toLowerCase()}`;
        addCamera(cameras, {
          id,
          title: [props.roadNumber, props.description, props.orientationDescription].filter(Boolean).join(' · ') || 'Cámara vial de Noruega',
          lat, lon, heading: 0, region: 'NO', sourceId: 'no-vegvesen',
          sourceName: 'Statens vegvesen · Noruega',
          license: 'NLOD 2.0 · Statens vegvesen', licenseStatus: 'verified',
          frameUrl: `${origin}/api/cctv-frame/${encodeURIComponent(id)}`
        });
        count++;
      }
      sources.push({ id: 'no-vegvesen', name: 'Statens vegvesen · Noruega', region: 'NO', status: count ? 'ok' : 'empty', count, license: 'NLOD 2.0' });
    } else {
      sources.push({ id: 'no-vegvesen', name: 'Statens vegvesen · Noruega', region: 'NO', status: 'error', count: 0, message: String(results[0].reason?.message || 'Error de fuente') });
    }

    // London — Transport for London JamCams, Open Government Licence v3.0.
    if (results[1].status === 'fulfilled') {
      const places = Array.isArray(results[1].value) ? results[1].value : [];
      let count = 0;
      for (const place of places) {
        const props = Object.fromEntries((place?.additionalProperties || []).filter((item) => item?.key).map((item) => [item.key, item.value]));
        if (String(props.available).toLowerCase() !== 'true') continue;
        const lat = Number(place?.lat);
        const lon = Number(place?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 51.2 || lat > 51.8 || lon < -0.6 || lon > 0.4) continue;
        const rawId = String(place?.id || '').replace(/^JamCams_/, '');
        if (!rawId || !/^[A-Za-z0-9._-]{1,60}$/.test(rawId)) continue;
        let image;
        try { image = new URL(String(props.imageUrl || '')); } catch { continue; }
        if (image.protocol !== 'https:' || image.origin !== TFL_IMAGE_ORIGIN || !image.pathname.startsWith('/jamcams.tfl.gov.uk/')) continue;
        const id = `tfl-${rawId.toLowerCase()}`;
        frameMaps.push([id, image.href]);
        addCamera(cameras, {
          id, title: String(place.commonName || `TfL JamCam ${rawId}`),
          lat, lon, heading: 0, region: 'GB-LND', sourceId: 'uk-tfl-jamcams',
          sourceName: 'Transport for London · Londres',
          license: 'Open Government Licence v3.0 · TfL Open Data', licenseStatus: 'verified',
          frameUrl: `${origin}/api/cctv-frame/${encodeURIComponent(id)}`
        });
        count++;
      }
      sources.push({ id: 'uk-tfl-jamcams', name: 'Transport for London · Londres', region: 'GB-LND', status: count ? 'ok' : 'empty', count, license: 'Open Government Licence v3.0' });
    } else {
      sources.push({ id: 'uk-tfl-jamcams', name: 'Transport for London · Londres', region: 'GB-LND', status: 'error', count: 0, message: String(results[1].reason?.message || 'Error de fuente') });
    }

    // Finland — Fintraffic / Digitraffic, CC BY 4.0.
    if (results[2].status === 'fulfilled') {
      const features = Array.isArray(results[2].value?.features) ? results[2].value.features : [];
      let count = 0;
      for (const feature of features) {
        const props = feature?.properties || {};
        const stationId = String(props.id || '').trim();
        if (!stationId || String(props.collectionStatus || '').toUpperCase() !== 'GATHERING') continue;
        const coords = feature?.geometry?.coordinates || [];
        const lon = Number(coords[0]);
        const lat = Number(coords[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 59 || lat > 71 || lon < 19 || lon > 32) continue;
        for (const preset of props.presets || []) {
          const presetId = String(preset?.id || '').trim();
          if (preset?.inCollection !== true || !/^C\d{7}$/.test(presetId) || !presetId.startsWith(stationId)) continue;
          const id = `fi-${presetId.toLowerCase()}`;
          addCamera(cameras, {
            id, title: `${String(props.name || stationId)} · ${presetId}`,
            lat, lon, heading: 0, region: 'FI', sourceId: 'fi-digitraffic-weathercams',
            sourceName: 'Fintraffic · Finlandia',
            license: 'CC BY 4.0 · Fintraffic / digitraffic.fi', licenseStatus: 'verified',
            frameUrl: `${origin}/api/cctv-frame/${encodeURIComponent(id)}`
          });
          count++;
        }
      }
      sources.push({ id: 'fi-digitraffic-weathercams', name: 'Fintraffic · Finlandia', region: 'FI', status: count ? 'ok' : 'empty', count, license: 'CC BY 4.0' });
    } else {
      sources.push({ id: 'fi-digitraffic-weathercams', name: 'Fintraffic · Finlandia', region: 'FI', status: 'error', count: 0, message: String(results[2].reason?.message || 'Error de fuente') });
    }

    // Cache official TfL image URLs by camera ID; no client-supplied URL is fetched.
    const cache = caches.default;
    await Promise.allSettled(frameMaps.map(([id, imageUrl]) => {
      const key = new Request(new URL(`/__cache/tfl-frame-map/${encodeURIComponent(id)}`, request.url));
      return cache.put(key, new Response(imageUrl, { headers: { 'Cache-Control': 'public, max-age=86400' } }));
    }));

    return new Response(JSON.stringify({ updatedAt: new Date().toISOString(), cameras, sources }), {
      status: 200,
      headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${CATALOG_TTL}` })
    });
  });
}

async function resolveFrameUrl(request, id) {
  if (id.startsWith('no-vegvesen-')) {
    const rawId = id.slice('no-vegvesen-'.length);
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(rawId)) return null;
    return NORWAY_IMAGE_ORIGIN + rawId;
  }
  if (id.startsWith('fi-c')) {
    const presetId = id.slice(3).toUpperCase();
    if (!/^C\d{7}$/.test(presetId)) return null;
    return FINLAND_IMAGE_ORIGIN + presetId + '.jpg';
  }
  if (id.startsWith('tfl-')) {
    if (!/^tfl-[A-Za-z0-9._-]{1,60}$/.test(id)) return null;
    const cacheKey = new Request(new URL(`/__cache/tfl-frame-map/${encodeURIComponent(id)}`, request.url));
    let mapped = await caches.default.match(cacheKey);
    if (!mapped) {
      await getCatalog(request);
      mapped = await caches.default.match(cacheKey);
    }
    if (!mapped) return null;
    const image = new URL(await mapped.text());
    if (image.protocol !== 'https:' || image.origin !== TFL_IMAGE_ORIGIN || !image.pathname.startsWith('/jamcams.tfl.gov.uk/')) return null;
    return image.href;
  }
  return null;
}

async function getFrame(request, rawId) {
  const id = decodeURIComponent(rawId);
  if (!/^(no-vegvesen-[A-Za-z0-9_-]{1,40}|fi-c\d{7}|tfl-[A-Za-z0-9._-]{1,60})$/i.test(id)) return json({ error: 'ID de cámara inválido' }, 400);
  const cacheKey = new Request(new URL(`/__cache/cctv-frame/${encodeURIComponent(id)}`, request.url));
  return cachedFetch(cacheKey, IMAGE_TTL, async () => {
    const upstreamUrl = await resolveFrameUrl(request, id);
    if (!upstreamUrl) return json({ error: 'No existe una imagen pública válida para esta cámara' }, 404);
    const upstream = await fetch(upstreamUrl, {
      method: 'GET', redirect: 'manual',
      headers: { 'Accept': 'image/jpeg,image/png,image/webp', 'User-Agent': 'OjoDeDios-CCTV/2.0' }
    });
    if (upstream.status >= 300 && upstream.status < 400) return json({ error: 'Redirección de imagen rechazada' }, 502);
    if (!upstream.ok) return json({ error: `Imagen oficial HTTP ${upstream.status}` }, 502);
    const type = String(upstream.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return json({ error: 'Tipo de imagen no permitido' }, 502);
    const bytes = await readLimited(upstream, IMAGE_LIMIT);
    return new Response(bytes, {
      status: 200,
      headers: corsHeaders({ 'Content-Type': type, 'Content-Length': String(bytes.byteLength), 'Cache-Control': `public, max-age=${IMAGE_TTL}` })
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
      if (match) return await getFrame(request, match[1]);
      if (url.pathname === '/health') return json({ service: 'ojo-de-dios-cctv', status: 'ok' });
      return json({ error: 'Ruta no encontrada' }, 404);
    } catch (error) {
      return json({ error: error?.message || 'Error de proxy CCTV' }, 502);
    }
  }
};
