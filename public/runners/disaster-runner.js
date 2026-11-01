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
async function checkQuakes(seen) {
  const data = await json(SOURCES.quakes);
  for (const quake of data.features || []) {
    const p = quake.properties || {}, c = quake.geometry?.coordinates || [];
    const lon = Number(c[0]), lat = Number(c[1]), depth = Number(c[2]), mag = Number(p.mag);
    if (![lon, lat, depth, mag].every(Number.isFinite) || mag < 5.5) continue;
    await alertOnce(seen, 'usgs:' + quake.id,
      '🚨 SISMO M' + mag.toFixed(1) + ' · ' + (p.place || 'Ubicación no informada'),
      'Profundidad ' + depth.toFixed(1) + ' km · ' + new Date(p.time).toLocaleString() + ' · Fuente USGS',
      { kind: 'earthquake', lat, lon, magnitude: mag, eventId: quake.id });
  }
}
async function checkNaturalEvents(seen) {
  const data = await json(SOURCES.eonet);
  const allowed = new Set(['severeStorms', 'wildfires', 'volcanoes', 'floods']);
  for (const event of data.events || []) {
    const categories = (event.categories || []).filter(c => allowed.has(c.id));
    if (!categories.length) continue;
    const geometry = event.geometry || [];
    const point = [...geometry].reverse().find(g => g.type === 'Point' && Array.isArray(g.coordinates));
    const lon = point ? Number(point.coordinates[0]) : null;
    const lat = point ? Number(point.coordinates[1]) : null;
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
addEventListener('checkDisasters', async (resolve, reject) => {
  try {
    const seen = await loadSeen();
    const results = await Promise.allSettled([checkQuakes(seen), checkNaturalEvents(seen), checkTropicalStorms(seen)]);
    CapacitorKV.set(KEY, JSON.stringify([...seen].slice(-1500)));
    const failures = results.filter(x => x.status === 'rejected');
    if (failures.length) console.warn('Fuentes de alertas con error:', failures.length);
    resolve();
  } catch (error) {
    console.error('Ojo de Dios background alerts:', error);
    reject(error);
  }
});
