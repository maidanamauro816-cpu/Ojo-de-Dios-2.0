type Bounds = { south: number; north: number; west: number; east: number };
type Vessel = { point: any; lastSeen: number; name: string; mmsi: string };

export function createMarineLayer({ viewer, Cesium, apiBase, statusElement }: {
  viewer: any;
  Cesium: any;
  apiBase: string;
  statusElement?: HTMLElement | null;
}) {
  const collection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
  const vessels = new Map<string, Vessel>();
  const MAX_VESSELS = 2500;
  const STALE_MS = 5 * 60 * 1000;
  let enabled = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pruneTimer: ReturnType<typeof setInterval> | null = null;
  let selectedEntity: any = null;

  function setStatus(message: string) {
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.hidden = !enabled;
  }

  function currentBounds(): Bounds | null {
    const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
    if (!rectangle) return null;
    const south = Cesium.Math.toDegrees(rectangle.south);
    const north = Cesium.Math.toDegrees(rectangle.north);
    const west = Cesium.Math.toDegrees(rectangle.west);
    const east = Cesium.Math.toDegrees(rectangle.east);
    if (![south, north, west, east].every(Number.isFinite) || north <= south) return null;
    return {
      south: Math.max(-90, south),
      north: Math.min(90, north),
      west: Math.max(-180, west),
      east: Math.min(180, east)
    };
  }

  function clearVessels() {
    collection.removeAll();
    vessels.clear();
    if (selectedEntity) viewer.entities.remove(selectedEntity);
    selectedEntity = null;
  }

  function parseMessage(raw: unknown) {
    let event: any;
    try { event = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(String(raw)); }
    catch { return; }
    if (event?.MessageType === 'SubscriptionConfirmation') {
      setStatus('AIS CONECTADO · SUSCRIPCIÓN DE LA ZONA VISIBLE');
      return;
    }
    const message = event?.Message || {};
    const report = message.PositionReport || message.StandardClassBPositionReport ||
      message.ExtendedClassBPositionReport || message.LongRangeAISBroadcastMessage;
    if (!report) return;
    const metadata = event?.MetaData || {};
    const lat = Number(report.Latitude ?? metadata.latitude ?? metadata.Latitude);
    const lon = Number(report.Longitude ?? metadata.longitude ?? metadata.Longitude);
    const mmsi = String(metadata.MMSI ?? report.UserID ?? report.MMSI ?? '').trim();
    if (!mmsi || !/^\d{9}$/.test(mmsi) || !Number.isFinite(lat) || !Number.isFinite(lon) ||
        lat < -90 || lat > 90 || lon < -180 || lon > 180) return;

    const name = String(metadata.ShipName || report.Name || `MMSI ${mmsi}`).trim();
    const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
    const existing = vessels.get(mmsi);
    if (existing) {
      existing.point.position = position;
      existing.lastSeen = Date.now();
      existing.name = name;
      existing.point.id = { source: 'AIS', mmsi, name, sog: report.Sog, cog: report.Cog };
    } else {
      if (vessels.size >= MAX_VESSELS) return;
      const point = collection.add({
        position,
        pixelSize: 7,
        color: Cesium.Color.fromCssColorString('#f2c85b'),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.9),
        outlineWidth: 1,
        id: { source: 'AIS', mmsi, name, sog: report.Sog, cog: report.Cog }
      });
      vessels.set(mmsi, { point, lastSeen: Date.now(), name, mmsi });
    }
    setStatus(`TRÁFICO MARÍTIMO AIS: ${vessels.size.toLocaleString('es-AR')} buques · zona visible`);
  }

  function buildSocketUrl(bounds: Bounds) {
    const root = String(apiBase || window.location.origin).replace(/\/+$/, '');
    const url = new URL(root + '/api/ais-stream');
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    for (const [key, value] of Object.entries(bounds)) url.searchParams.set(key, String(value));
    return url.toString();
  }

  function connect() {
    if (!enabled) return;
    const bounds = currentBounds();
    if (!bounds) {
      setStatus('AIS: acercá el globo a una región para consultar barcos');
      return;
    }
    if (socket) {
      socket.onclose = null;
      socket.close(1000, 'Actualizando zona visible');
      socket = null;
    }
    clearVessels();
    setStatus('CONECTANDO RED AIS PÚBLICA…');
    try {
      socket = new WebSocket(buildSocketUrl(bounds));
      socket.onopen = () => setStatus('AIS CONECTADO · RECIBIENDO POSICIONES…');
      socket.onmessage = (event) => parseMessage(event.data);
      socket.onerror = () => setStatus('AIS SIN CONEXIÓN · revisar clave AISSTREAM_API_KEY y proxy');
      socket.onclose = (event) => {
        if (enabled && event.code !== 1000) setStatus('AIS DESCONECTADO · revisá la clave o la cobertura');
      };
    } catch {
      setStatus('AIS NO DISPONIBLE · falta configurar el proxy HTTPS');
    }
  }

  function onCameraMove() {
    if (!enabled) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1400);
  }

  function onPick(movement: any) {
    if (!enabled) return;
    const picked = viewer.scene.pick(movement.position);
    const data = picked?.id;
    if (!data || data.source !== 'AIS') return;
    if (selectedEntity) viewer.entities.remove(selectedEntity);
    selectedEntity = viewer.entities.add({
      name: data.name,
      position: picked.primitive?.position || undefined,
      point: { pixelSize: 12, color: Cesium.Color.WHITE, outlineColor: Cesium.Color.fromCssColorString('#f2c85b'), outlineWidth: 3 },
      label: {
        text: `🚢 ${data.name} · MMSI ${data.mmsi}`,
        font: 'bold 12px sans-serif',
        fillColor: Cesium.Color.fromCssColorString('#f2c85b'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -22),
        disableDepthTestDistance: 10000000
      },
      description: `<strong>${String(data.name).replace(/[&<>"]/g, '')}</strong><br>MMSI: ${data.mmsi}<br>Fuente: AISStream · AIS público<br>Velocidad: ${Number.isFinite(Number(data.sog)) ? data.sog + ' kn' : 's/d'}<br>Rumbo: ${Number.isFinite(Number(data.cog)) ? data.cog + '°' : 's/d'}<br><small>La cobertura depende de receptores AIS participantes; no representa todos los buques del planeta.</small>`
    });
    viewer.selectedEntity = selectedEntity;
  }

  const clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  clickHandler.setInputAction(onPick, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  function pruneStale() {
    const cutoff = Date.now() - STALE_MS;
    for (const [mmsi, vessel] of vessels) {
      if (vessel.lastSeen < cutoff) {
        collection.remove(vessel.point);
        vessels.delete(mmsi);
      }
    }
  }

  function setEnabled(value: boolean) {
    enabled = Boolean(value);
    collection.show = enabled;
    if (enabled) {
      connect();
      viewer.camera.moveEnd.addEventListener(onCameraMove);
      if (!pruneTimer) pruneTimer = setInterval(pruneStale, 60000);
    } else {
      viewer.camera.moveEnd.removeEventListener(onCameraMove);
      if (socket) {
        socket.onclose = null;
        socket.close(1000, 'Capa AIS desactivada');
        socket = null;
      }
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (pruneTimer) clearInterval(pruneTimer);
      pruneTimer = null;
      clearVessels();
      setStatus('');
    }
  }

  return { setEnabled, getState: () => ({ enabled, count: vessels.size, connected: socket?.readyState === WebSocket.OPEN }) };
}
