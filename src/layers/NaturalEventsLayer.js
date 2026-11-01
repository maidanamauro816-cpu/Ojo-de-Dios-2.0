const ACCEPTED = new Set(['severeStorms', 'wildfires', 'volcanoes', 'floods', 'landslides']);
export class NaturalEventsLayer {
  constructor(viewer, onStatus = () => {}) {
    this.viewer = viewer; this.onStatus = onStatus; this.entities = new Map();
    this.visible = false; this.timer = null; this.controller = null;
  }
  async refresh() {
    if (!this.visible) return;
    this.controller?.abort(); this.controller = new AbortController();
    this.onStatus({ loading: true, count: this.entities.size });
    try {
      const response = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100', {
        cache: 'no-store', signal: this.controller.signal, headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('NASA EONET HTTP ' + response.status);
      const data = await response.json(); const incoming = new Set();
      for (const event of data.events || []) {
        const categories = (event.categories || []).filter(c => ACCEPTED.has(c.id));
        if (!categories.length) continue;
        const geometry = event.geometry || [];
        const latest = [...geometry].reverse().find(g => g.coordinates);
        const point = latest ? findPoint(latest.coordinates) : null;
        if (!point) continue;
        const [lon, lat] = point;
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
        const ids = categories.map(c => c.id);
        const color = ids.includes('wildfires') ? '#ff5b35' : ids.includes('severeStorms') ? '#b18cff' : ids.includes('floods') ? '#42bfff' : '#ffca58';
        const name = event.title || categories[0].title || 'Evento natural';
        const description = '<b>' + esc(name) + '</b><br>' + esc(categories.map(c => c.title || c.id).join(', ')) +
          '<br>Actualizado: ' + esc(latest.date || '') + '<br><small>NASA EONET · evento reportado, verificar avisos oficiales locales</small>';
        incoming.add(event.id);
        let entity = this.entities.get(event.id);
        const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
        if (!entity) {
          entity = this.viewer.entities.add({
            id: 'natural-' + event.id, name, position,
            point: { pixelSize: 10, color: Cesium.Color.fromCssColorString(color), outlineColor: Cesium.Color.WHITE, outlineWidth: 1.5 },
            label: { text: ids.includes('wildfires') ? '🔥' : ids.includes('severeStorms') ? '⛈' : ids.includes('floods') ? '🌊' : '⚠', font: '14px sans-serif', pixelOffset: new Cesium.Cartesian2(0, -16), scaleByDistance: new Cesium.NearFarScalar(1e5, 1, 1e7, 0.4) },
            description
          });
          this.entities.set(event.id, entity);
        } else { entity.position = position; entity.description = description; entity.show = true; }
      }
      for (const [id, entity] of this.entities) if (!incoming.has(id)) { this.viewer.entities.remove(entity); this.entities.delete(id); }
      this.onStatus({ loading: false, count: this.entities.size, updatedAt: new Date().toISOString() });
    } catch (error) {
      if (error.name !== 'AbortError') this.onStatus({ loading: false, count: this.entities.size, error: error.message });
    }
  }
  setVisible(value) {
    this.visible = value;
    for (const entity of this.entities.values()) entity.show = value;
    if (this.timer) clearInterval(this.timer);
    if (value) { this.refresh(); this.timer = setInterval(() => this.refresh(), 10 * 60 * 1000); }
    else this.controller?.abort();
  }
  destroy() {
    if (this.timer) clearInterval(this.timer);
    this.controller?.abort();
    for (const entity of this.entities.values()) this.viewer.entities.remove(entity);
    this.entities.clear();
  }
}
function findPoint(value) {
  if (!Array.isArray(value)) return null;
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') return value;
  for (const child of value) { const point = findPoint(child); if (point) return point; }
  return null;
}
function esc(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
