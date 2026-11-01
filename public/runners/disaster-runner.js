const KEY = 'ojo-dios-bg-seen-v1';
const SETTINGS_KEY = 'ojo-dios-alert-settings-v1';
const SOURCES = {
  quakes: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson',
  smn: 'https://ssl.smn.gob.ar/feeds/CAP/rss_alertaCAP_nuevo.xml',
  eonet: 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100',
  storms: 'https://www.nhc.noaa.gov/CurrentStorms.json'
};
function idFor(value) {
  let hash = 2166136261;
  for (const ch of String(value)) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) % 2147483000 + 1;
}
async function json(url) {
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' · ' + url);
  return response.json();
}
async function loadSeen() {
  try { return new Set(JSON.parse(CapacitorKV.get(KEY).value || '[]')); }
  catch { return new Set(); }
}
async function alertOnce(seen, key, title, body, extra = {}) {
  if (seen.has(key)) return;
  seen.add(key);
  await CapacitorNotifications.schedule({
    id: idFor(key), title, body,
    channelId: extra.kind === 'earthquake' ? 'sismos-live' : 'desastres-live',
    extra
  });
}
function distanceKm(a, b) { const r = Math.PI / 180, dLat = (b.latitude - a.latitude) * r, dLon = (b.longitude - a.longitude) * r; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin(dLon / 2) ** 2; return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)); }
async function getSettings() {
  try { return JSON.parse(CapacitorKV.get(SETTINGS_KEY).value || '{}'); }
  catch { return {}; }
}
async function getAlertCenter(settings) {
  try {
    const p = await CapacitorGeolocation.getCurrentPosition();
    const center = { latitude: Number(p.latitude), longitude: Number(p.longitude) };
    if (Number.isFinite(center.latitude) && Number.isFinite(center.longitude)) {
      settings.latitude = center.latitude;
      settings.longitude = center.longitude;
      CapacitorKV.set(SETTINGS_KEY, JSON.stringify(settings));
      return center;
    }
  } catch (error) { console.info('Ubicación en segundo plano no disponible; usando última posición autorizada.', error); }
  const latitude = Number(settings.latitude), longitude = Number(settings.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}
async function checkQuakes(seen, center, radiusKm) {
  const data = await json(SOURCES.quakes);
  for (const quake of data.features || []) {
    const p = quake.properties || {}, c = quake.geometry?.coordinates || [];
    const lon = Number(c[0]), lat = Number(c[1]), depth = Number(c[2]), mag = Number(p.mag);
    if (![lon, lat, depth, mag].every(Number.isFinite)) continue;
    const nearby = center && distanceKm(center, { latitude: lat, longitude: lon }) <= radiusKm;
    if (mag < 6.5 && !(nearby && mag >= 3.0)) continue;
    await alertOnce(seen, 'usgs:' + quake.id,
      '🚨 SISMO M' + mag.toFixed(1) + ' · ' + (p.place || 'Ubicación no informada'),
      'Profundidad ' + depth.toFixed(1) + ' km · ' + new Date(p.time).toLocaleString() + ' · Fuente USGS',
      { kind: 'earthquake', lat, lon, magnitude: mag, eventId: quake.id });
  }
}
async function checkNaturalEvents(seen, center, radiusKm) {
  const data = await json(SOURCES.eonet);
  const allowed = new Set(['severeStorms', 'wildfires', 'volcanoes', 'floods']);
  for (const event of data.events || []) {
    const categories = (event.categories || []).filter(c => allowed.has(c.id));
    if (!categories.length) continue;
    const geometry = event.geometry || [];
    const point = [...geometry].reverse().find(g => g.type === 'Point' && Array.isArray(g.coordinates));
    const lon = point ? Number(point.coordinates[0]) : null;
    const lat = point ? Number(point.coordinates[1]) : null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (center && distanceKm(center, { latitude: lat, longitude: lon }) > radiusKm) continue;
    const category = categories.map(c => c.title || c.id).join(', ');
    await alertOnce(seen, 'eonet:' + event.id,
      '🌍 ALERTA NATURAL · ' + (event.title || category),
      category + ' · Fuente NASA EONET. Verificá el parte oficial antes de actuar.',
      { kind: 'natural-event', lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null, eventId: event.id });
  }
}
async function checkTropicalStorms(seen, center, radiusKm) {
  const data = await json(SOURCES.storms);
  for (const storm of data.activeStorms || data.active_storms || []) {
    const id = storm.id || storm.atcf || storm.name;
    if (!id) continue;
    const lat = Number(storm.latitude ?? storm.lat), lon = Number(storm.longitude ?? storm.lon);
    if (center && Number.isFinite(lat) && Number.isFinite(lon) && distanceKm(center, { latitude: lat, longitude: lon }) > radiusKm) continue;
    await alertOnce(seen, 'noaa:' + id, '🌀 NOAA · ' + (storm.name || 'Sistema tropical activo'),
      'Sistema tropical activo. Consultá el parte oficial del Centro Nacional de Huracanes.',
      { kind: 'tropical-storm', lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null, eventId: String(id) });
  }
}

function firstPoint(value) {
  if (!Array.isArray(value)) return null;
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') return value;
  for (const child of value) { const point = firstPoint(child); if (point) return point; }
  return null;
}
async function checkOfficialWarnings(seen, center, radiusKm) {
  const response = await fetch('https://api.weather.gov/alerts/active?status=actual&message_type=alert', {
    method: 'GET',
    headers: { Accept: 'application/geo+json', 'User-Agent': 'Ojo-de-Dios-2.0 public safety alerts' }
  });
  if (!response.ok) throw new Error('NWS alerts HTTP ' + response.status);
  const data = await response.json();
  const accepted = new Set(['Tornado Warning', 'Severe Thunderstorm Warning', 'Flash Flood Warning', 'Hurricane Warning', 'Tropical Storm Warning']);
  for (const feature of data.features || []) {
    const p = feature.properties || {};
    if (!accepted.has(p.event)) continue;
    const point = firstPoint(feature.geometry?.coordinates);
    const lon = point ? Number(point[0]) : null, lat = point ? Number(point[1]) : null;
    if (center && Number.isFinite(lat) && Number.isFinite(lon) && distanceKm(center, { latitude: lat, longitude: lon }) > radiusKm) continue;
    await alertOnce(seen, 'nws:' + (feature.id || p.id || p.sent),
      '⚠️ ' + p.event.toUpperCase() + ' · ' + (p.areaDesc || 'Alerta oficial'),
      (p.headline || p.description || p.event) + ' · Servicio Meteorológico Nacional de EE. UU.',
      { kind: 'official-weather-warning', lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null, eventId: feature.id || p.id });
  }
}

function xmlText(block, tag) {
  const match = block.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i'));
  return match ? match[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').trim() : '';
}
function pointInPolygon(point, polygon) {
  const x = point.longitude, y = point.latitude;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].longitude, yi = polygon[i].latitude;
    const xj = polygon[j].longitude, yj = polygon[j].latitude;
    const crosses = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}
async function checkSmnWarnings(seen, center) {
  if (!center) return;
  const response = await fetch(SOURCES.smn, { headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
  if (!response.ok) throw new Error('SMN CAP RSS HTTP ' + response.status);
  const feed = await response.text();
  const items = feed.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || [];
  for (const item of items) {
    const link = xmlText(item, 'link');
    if (!link || !/^https?:\/\//i.test(link)) continue;
    const capResponse = await fetch(link, { headers: { Accept: 'application/xml, text/xml' } });
    if (!capResponse.ok) continue;
    const cap = await capResponse.text();
    const identifier = xmlText(cap, 'identifier') || link;
    const infoBlocks = cap.match(/<info(?:\s[^>]*)?>[\s\S]*?<\/info>/gi) || [cap];
    for (const info of infoBlocks) {
      const areas = info.match(/<area(?:\s[^>]*)?>[\s\S]*?<\/area>/gi) || [];
      for (const area of areas) {
        const polygonText = xmlText(area, 'polygon');
        const polygon = polygonText.split(/\s+/).map(pair => {
          const values = pair.split(',').map(Number);
          return values.length === 2 ? { latitude: values[0], longitude: values[1] } : null;
        }).filter(p => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
        if (polygon.length < 3 || !pointInPolygon(center, polygon)) continue;
        const event = xmlText(info, 'event') || 'Alerta meteorológica';
        const headline = xmlText(info, 'headline') || event;
        const description = xmlText(info, 'description') || xmlText(info, 'instruction') || 'Consultá las recomendaciones oficiales.';
        const severity = xmlText(info, 'severity');
        const sent = xmlText(cap, 'sent');
        await alertOnce(seen, 'smn:' + identifier + ':' + event + ':' + sent,
          '🇦🇷 SMN · ' + event.toUpperCase(),
          headline + ' · ' + description.slice(0, 220) + (severity ? ' · Nivel: ' + severity : '') + ' · Servicio Meteorológico Nacional',
          { kind: 'official-weather-warning', source: 'SMN Argentina', event, severity });
      }
    }
  }
}

addEventListener('saveAlertSettings', (resolve, reject, args) => {
  try {
    const details = args || {};
    const settings = {
      enabled: details.enabled === true,
      radiusKm: Math.max(10, Math.min(1000, Number(details.radiusKm) || 100)),
      latitude: Number.isFinite(Number(details.latitude)) ? Number(details.latitude) : null,
      longitude: Number.isFinite(Number(details.longitude)) ? Number(details.longitude) : null
    };
    CapacitorKV.set(SETTINGS_KEY, JSON.stringify(settings));
    resolve();
  } catch (error) { reject(error); }
});

addEventListener('checkDisasters', async (resolve, reject) => {
  try {
    const settings = await getSettings();
    const radiusKm = Math.max(10, Math.min(1000, Number(settings.radiusKm) || 100));
    const seen = await loadSeen();
    // La detección sísmica mundial de gran magnitud funciona siempre, sin exigir GPS.
    // La ubicación solo habilita los avisos regionales y meteorológicos cercanos.
    const center = settings.enabled === true ? await getAlertCenter(settings) : null;
    const checks = [checkQuakes(seen, center, radiusKm)];
    if (settings.enabled === true && center) {
      checks.push(
        checkNaturalEvents(seen, center, radiusKm),
        checkTropicalStorms(seen, center, radiusKm),
        checkOfficialWarnings(seen, center, radiusKm),
        checkSmnWarnings(seen, center)
      );
    }
    const results = await Promise.allSettled(checks);
    CapacitorKV.set(KEY, JSON.stringify([...seen].slice(-1500)));
    const failures = results.filter(x => x.status === 'rejected');
    if (failures.length) console.warn('Fuentes de alertas con error:', failures.length);
    resolve();
  } catch (error) {
    console.error('Ojo de Dios background alerts:', error);
    reject(error);
  }
});
