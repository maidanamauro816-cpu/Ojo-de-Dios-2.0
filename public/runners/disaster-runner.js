const KEY = 'ojo-dios-bg-seen-v1';
const SOURCES = {
  quakes: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson',
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
async function getAlertCenter() { try { const p = await CapacitorGeolocation.getCurrentPosition(); return { latitude: Number(p.latitude), longitude: Number(p.longitude) }; } catch { return null; } }
async function checkQuakes(seen, center) {
  const data = await json(SOURCES.quakes);
  for (const quake of data.features || []) {
    const p = quake.properties || {}, c = quake.geometry?.coordinates || [];
    const lon = Number(c[0]), lat = Number(c[1]), depth = Number(c[2]), mag = Number(p.mag);
    if (![lon, lat, depth, mag].every(Number.isFinite)) continue;
    const nearby = center && distanceKm(center, { latitude: lat, longitude: lon }) <= 1000;
    if (mag < 5.5 && !(nearby && mag >= 3.0)) continue;
    await alertOnce(seen, 'usgs:' + quake.id,
      '🚨 SISMO M' + mag.toFixed(1) + ' · ' + (p.place || 'Ubicación no informada'),
      'Profundidad ' + depth.toFixed(1) + ' km · ' + new Date(p.time).toLocaleString() + ' · Fuente USGS',
      { kind: 'earthquake', lat, lon, magnitude: mag, eventId: quake.id });
  }
}
async function checkNaturalEvents(seen, center) {
  const data = await json(SOURCES.eonet);
  const allowed = new Set(['severeStorms', 'wildfires', 'volcanoes', 'floods']);
  for (const event of data.events || []) {
    const categories = (event.categories || []).filter(c => allowed.has(c.id));
    if (!categories.length) continue;
    const geometry = event.geometry || [];
    const point = [...geometry].reverse().find(g => g.type === 'Point' && Array.isArray(g.coordinates));
    const lon = point ? Number(point.coordinates[0]) : null;
    const lat = point ? Number(point.coordinates[1]) : null;
    if (center && Number.isFinite(lat) && Number.isFinite(lon) && distanceKm(center, { latitude: lat, longitude: lon }) > 1200) continue;
    const category = categories.map(c => c.title || c.id).join(', ');
    await alertOnce(seen, 'eonet:' + event.id,
      '🌍 ALERTA NATURAL · ' + (event.title || category),
      category + ' · Fuente NASA EONET. Verificá el parte oficial antes de actuar.',
      { kind: 'natural-event', lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null, eventId: event.id });
  }
}
async function checkTropicalStorms(seen) {
  const data = await json(SOURCES.storms);
  for (const storm of data.activeStorms || data.active_storms || []) {
    const id = storm.id || storm.atcf || storm.name;
    if (!id) continue;
    const lat = Number(storm.latitude ?? storm.lat), lon = Number(storm.longitude ?? storm.lon);
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
async function checkOfficialWarnings(seen) {
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
    await alertOnce(seen, 'nws:' + (feature.id || p.id || p.sent),
      '⚠️ ' + p.event.toUpperCase() + ' · ' + (p.areaDesc || 'Alerta oficial'),
      (p.headline || p.description || p.event) + ' · Servicio Meteorológico Nacional de EE. UU.',
      { kind: 'official-weather-warning', lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null, eventId: feature.id || p.id });
  }
}

addEventListener('checkDisasters', async (resolve, reject) => {
  try {
    const seen = await loadSeen();
    const center = await getAlertCenter();
    const results = await Promise.allSettled([checkQuakes(seen, center), checkNaturalEvents(seen, center), checkTropicalStorms(seen), checkOfficialWarnings(seen)]);
    CapacitorKV.set(KEY, JSON.stringify([...seen].slice(-1500)));
    const failures = results.filter(x => x.status === 'rejected');
    if (failures.length) console.warn('Fuentes de alertas con error:', failures.length);
    resolve();
  } catch (error) {
    console.error('Ojo de Dios background alerts:', error);
    reject(error);
  }
});
