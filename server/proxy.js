import https from 'node:https';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { loadAllCameras, CCTV_REGISTRY } from '../src/data/cctv/index.js';

const CATALOG_TTL_MS = 60_000;
const CATALOG_MAX_BYTES = 4 * 1024 * 1024;
const FRAME_MAX_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

let catalogCache = null;
let catalogLoadedAt = 0;
let refreshPromise = null;
const lastGoodBySource = new Map();
const cameraIndex = new Map();

function ipv4IsPublic(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0)
  );
}

function ipIsPublic(address) {
  const family = net.isIP(address);
  if (family === 4) return ipv4IsPublic(address);
  if (family === 6) {
    const value = address.toLowerCase();
    if (value.startsWith('::ffff:')) return ipv4IsPublic(value.slice(7));
    return !(
      value === '::' || value === '::1' ||
      value.startsWith('fc') || value.startsWith('fd') ||
      value.startsWith('fe8') || value.startsWith('fe9') ||
      value.startsWith('fea') || value.startsWith('feb') ||
      value.startsWith('ff')
    );
  }
  return false;
}

function hostMatches(hostname, allowedHosts = []) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return allowedHosts.some((entry) => {
    const allowed = String(entry).toLowerCase();
    return host === allowed || host.endsWith('.' + allowed);
  });
}

/**
 * HTTPS-only, DNS-pinned request. Redirects are never followed. The DNS result
 * is checked and the socket is pinned to that public address to reduce rebinding.
 */
async function requestCapped(rawUrl, { allowedHosts = [], maxBytes = FRAME_MAX_BYTES, headers = {} } = {}) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('Solo se permiten URLs HTTPS públicas en puerto 443');
  }
  if (net.isIP(url.hostname) || !hostMatches(url.hostname, allowedHosts)) {
    throw new Error('Host fuera de la lista permitida CCTV');
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => !ipIsPublic(item.address))) {
    throw new Error('DNS resolvió a una dirección no pública; solicitud bloqueada');
  }
  const pinned = addresses[0];
  const extraHeaders = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (name.toLowerCase() === 'digitraffic-user' && typeof value === 'string' && value.length <= 120) {
      extraHeaders['digitraffic-user'] = value;
    }
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finishError = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = https.request({
      protocol: 'https:',
      hostname: url.hostname,
      port: 443,
      servername: url.hostname,
      method: 'GET',
      path: url.pathname + url.search,
      headers: {
        accept: 'application/json,image/jpeg,image/png,image/webp,image/gif;q=0.9,*/*;q=0.1',
        'user-agent': 'OjoDeDios-CCTV/2.0 (+public government traffic camera viewer)',
        ...extraHeaders
      },
      lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
      timeout: REQUEST_TIMEOUT_MS
    }, (response) => {
      const status = response.statusCode || 502;
      if (status >= 300 && status < 400) {
        response.destroy();
        finishError(new Error('Redirección upstream bloqueada'));
        return;
      }
      const declared = Number(response.headers['content-length'] || 0);
      if (declared > maxBytes) {
        response.destroy();
        finishError(new Error('Respuesta supera el límite de bytes'));
        return;
      }
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          response.destroy(new Error('Respuesta supera el límite de bytes'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', finishError);
      response.on('end', () => {
        if (settled) return;
        settled = true;
        resolve({
          status,
          headers: response.headers,
          body: Buffer.concat(chunks, total)
        });
      });
    });
    request.on('timeout', () => request.destroy(new Error('Timeout upstream')));
    request.on('error', finishError);
    request.end();
  });
}

function asResponse(result) {
  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    headers: { get: (name) => result.headers[String(name).toLowerCase()] || null },
    json: async () => JSON.parse(result.body.toString('utf8')),
    text: async () => result.body.toString('utf8'),
    arrayBuffer: async () => result.body.buffer.slice(
      result.body.byteOffset, result.body.byteOffset + result.body.byteLength
    )
  };
}

async function fetchWithCap(url, options = {}) {
  if (options.redirect !== 'error') throw new Error('El proxy exige redirect: error');
  const result = await requestCapped(url, {
    allowedHosts: options.allowedHosts || [],
    maxBytes: Math.min(Number(options.maxBytes) || CATALOG_MAX_BYTES, CATALOG_MAX_BYTES),
    headers: options.headers || {}
  });
  return asResponse(result);
}

async function refreshCatalog() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const loaded = await loadAllCameras({
      fetchWithCap,
      sources: CCTV_REGISTRY,
      perSourceLimit: 2000
    });
    const cameras = [];
    const sources = [];
    for (const result of loaded.sources) {
      const current = loaded.cameras.filter((camera) => camera.sourceId === result.id);
      if (result.status === 'ok') lastGoodBySource.set(result.id, current);
      const finalCameras = result.status === 'error' && lastGoodBySource.has(result.id)
        ? lastGoodBySource.get(result.id)
        : current;
      cameras.push(...finalCameras);
      sources.push({
        ...result,
        count: finalCameras.length,
        status: result.status === 'error' && finalCameras.length ? 'stale' : result.status
      });
    }
    catalogCache = { cameras, sources, updatedAt: Date.now() };
    cameraIndex.clear();
    for (const camera of cameras) cameraIndex.set(camera.id, camera);
    catalogLoadedAt = Date.now();
    return catalogCache;
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

async function getCatalog() {
  if (catalogCache && Date.now() - catalogLoadedAt < CATALOG_TTL_MS) return catalogCache;
  return refreshCatalog();
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

export function cctvProxy() {
  return {
    name: 'ojo-de-dios-cctv-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url || '/', 'http://localhost').pathname;
        if (req.method !== 'GET' || !pathname.startsWith('/api/cctv')) return next();
        try {
          if (pathname === '/api/cctv/catalog') {
            const catalog = await getCatalog();
            sendJson(res, 200, {
              updatedAt: catalog.updatedAt,
              cameras: catalog.cameras.map((camera) => ({
                id: camera.id, title: camera.title, lat: camera.lat, lon: camera.lon,
                heading: camera.heading, region: camera.region, sourceId: camera.sourceId,
                sourceName: camera.sourceName, license: camera.meta.license,
                licenseStatus: camera.meta.licenseStatus,
                frameUrl: `/api/cctv-frame/${encodeURIComponent(camera.id)}`
              })),
              sources: catalog.sources
            });
            return;
          }

          const match = /^\/api\/cctv-frame\/([^/]+)$/.exec(pathname);
          if (match) {
            const id = decodeURIComponent(match[1]);
            const camera = cameraIndex.get(id) || (await getCatalog()).cameras.find((item) => item.id === id);
            if (!camera?.pose?.imageUrl) {
              sendJson(res, 404, { error: 'Imagen pública no disponible para esta cámara' });
              return;
            }
            const source = CCTV_REGISTRY.find((item) => item.id === camera.sourceId);
            const upstream = await requestCapped(camera.pose.imageUrl, {
              allowedHosts: source?.allowedHosts || [],
              maxBytes: FRAME_MAX_BYTES
            });
            const type = String(upstream.headers['content-type'] || '').split(';')[0].toLowerCase();
            if (upstream.status < 200 || upstream.status >= 300 || !IMAGE_TYPES.has(type)) {
              sendJson(res, 502, { error: 'La fuente no devolvió una imagen raster permitida' });
              return;
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', type);
            res.setHeader('Content-Length', String(upstream.body.length));
            res.setHeader('Cache-Control', 'public, max-age=10, stale-while-revalidate=20');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.end(upstream.body);
            return;
          }
          sendJson(res, 404, { error: 'Ruta CCTV desconocida' });
        } catch (error) {
          sendJson(res, 502, { error: error?.message || 'Error del proxy CCTV' });
        }
      });
    }
  };
}
