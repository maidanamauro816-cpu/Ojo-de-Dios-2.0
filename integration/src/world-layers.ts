declare const WebSocket: any;

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch] || ch));

export function initWorldLayers(viewer: any, Cesium: any) {
  const container = document.querySelector('.layers-container');
  if (!container) return;

  function addButton(id: string, icon: string, title: string, subtitle: string, toggle: (enabled: boolean) => void) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'layer';
    button.dataset.worldLayer = id;
    const glyph = document.createElement('span');
    glyph.className = 'layer-icon';
    glyph.textContent = icon;
    const info = document.createElement('span');
    info.className = 'layer-info';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const status = document.createElement('small');
    status.textContent = subtitle;
    info.append(strong, status);
    const state = document.createElement('span');
    state.className = 'layer-state';
    state.textContent = 'OFF';
    button.append(glyph, info, state);
    let enabled = false;
    button.addEventListener('click', () => {
      enabled = !enabled;
      button.classList.toggle('active', enabled);
      state.textContent = enabled ? 'ON' : 'OFF';
      toggle(enabled);
    });
    container.appendChild(button);
    return { button, status };
  }

  function bounds() {
    const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
    if (!rect) return null;
    const b = {
      south: Cesium.Math.toDegrees(rect.south),
      west: Cesium.Math.toDegrees(rect.west),
      north: Cesium.Math.toDegrees(rect.north),
      east: Cesium.Math.toDegrees(rect.east)
    };
    if (!Object.values(b).every(Number.isFinite) || b.west > b.east) return null;
    return b;
  }

  const installationEntities = new Map<string, any>();
  let installationsOn = false;
  let installationBusy = false;
  let lastBox = '';
  let lastInstallTime = 0;
  const installation = addButton(
    'public-installations', '🏛️', 'INSTALACIONES PÚBLICAS',
    'Aeródromos e instalaciones cartografiadas',
    (on) => {
      installationsOn = on;
      for (const entity of installationEntities.values()) entity.show = on;
      if (on) void refreshInstallations(true);
    }
  );

  async function refreshInstallations(force = false) {
    if (!installationsOn || installationBusy) return;
    const b = bounds();
    if (!b) {
      installation.status.textContent = 'Esperando vista terrestre';
      return;
    }
    if (viewer.camera.positionCartographic.height > 9000000) {
      installation.status.textContent = 'Acercá el mapa para consultar esta zona';
      return;
    }
    const key = [b.south, b.west, b.north, b.east].map((v) => v.toFixed(2)).join(',');
    if (!force && key === lastBox && Date.now() - lastInstallTime < 60000) return;

    installationBusy = true;
    installation.status.textContent = 'Consultando OpenStreetMap…';
    const box = b.south + ',' + b.west + ',' + b.north + ',' + b.east;
    const query = '[out:json][timeout:20];(nwr["military"~"^(airfield|barracks|naval_base|base|training_area)$"](' + box + ');nwr["aeroway"="aerodrome"](' + box + '););out center tags;';

    try {
      let data: any = null;
      let lastError: unknown = null;
      for (const endpoint of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: new URLSearchParams({ data: query }).toString(),
            cache: 'no-store'
          });
          if (!response.ok) throw new Error('Overpass HTTP ' + response.status);
          data = await response.json();
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!data || !Array.isArray(data.elements)) throw lastError || new Error('Directorio no disponible');

      const current = new Set<string>();
      for (const element of data.elements) {
        const tags = element.tags || {};
        const lat = Number(element.lat ?? element.center?.lat);
        const lon = Number(element.lon ?? element.center?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const military = String(tags.military || '');
        const isMilitary = Boolean(military);
        const category = isMilitary ? 'Instalación cartografiada: ' + military.replace(/_/g, ' ') : 'Aeródromo cartografiado';
        const name = String(tags.name || tags['name:en'] || tags.ref || (isMilitary ? 'Instalación sin nombre publicado' : 'Aeródromo sin nombre publicado'));
        const id = String(element.type) + '/' + String(element.id);
        current.add(id);
        const description = '<b>' + escapeHtml(name) + '</b><p>' + escapeHtml(category) + '</p><p>Coordenadas: ' + lat.toFixed(5) + ', ' + lon.toFixed(5) + '</p><p>Fuente: OpenStreetMap contributors</p><p>La etiqueta cartográfica no confirma actividad ni estado operativo.</p>';
        const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
        let entity = installationEntities.get(id);
        if (!entity) {
          entity = viewer.entities.add({
            name,
            position,
            point: {
              pixelSize: isMilitary ? 8 : 7,
              color: isMilitary ? Cesium.Color.fromCssColorString('#d7a84b') : Cesium.Color.fromCssColorString('#60a5fa'),
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 1
            },
            label: {
              text: isMilitary ? 'INSTALACIÓN' : 'AERÓDROMO',
              font: 'bold 9px sans-serif',
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(0, -13),
              scaleByDistance: new Cesium.NearFarScalar(50000, 1, 1500000, 0.25)
            },
            description
          });
          installationEntities.set(id, entity);
        } else {
          entity.name = name;
          entity.position = position;
          entity.description = description;
          entity.show = true;
        }
      }
      for (const [id, entity] of installationEntities) {
        if (!current.has(id)) {
          viewer.entities.remove(entity);
          installationEntities.delete(id);
        }
      }
      lastBox = key;
      lastInstallTime = Date.now();
      installation.status.textContent = current.size.toLocaleString() + ' registros públicos en esta vista';
    } catch (error) {
      installation.status.textContent = 'OpenStreetMap temporalmente no disponible';
      console.warn('OpenStreetMap Overpass error', error);
    } finally {
      installationBusy = false;
    }
  }

  const earthquakeEntities = new Map<string, any>();
  let earthquakesOn = false;
  let earthquakeBusy = false;
  const earthquakes = addButton(
    'earthquakes', '🌋', 'TERREMOTOS · USGS',
    'Eventos sísmicos globales · últimas 24 h',
    (on) => {
      earthquakesOn = on;
      for (const entity of earthquakeEntities.values()) entity.show = on;
      if (on) void refreshEarthquakes();
    }
  );

  async function refreshEarthquakes() {
    if (!earthquakesOn || earthquakeBusy) return;
    earthquakeBusy = true;
    earthquakes.status.textContent = 'Actualizando USGS…';
    try {
      const response = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson', { cache: 'no-store' });
      if (!response.ok) throw new Error('USGS HTTP ' + response.status);
      const data = await response.json();
      const features = Array.isArray(data.features) ? data.features : [];
      const current = new Set<string>();
      for (const feature of features) {
        const coordinates = feature.geometry?.coordinates || [];
        const lon = Number(coordinates[0]);
        const lat = Number(coordinates[1]);
        const depth = Number(coordinates[2]);
        const props = feature.properties || {};
        const magnitude = Number(props.mag);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(magnitude)) continue;
        const id = String(feature.id || (lat + ',' + lon + ',' + props.time));
        current.add(id);
        const description = '<b>' + escapeHtml(props.place || 'Ubicación no informada') + '</b><p>Magnitud: ' + magnitude.toFixed(1) + '</p><p>Profundidad: ' + (Number.isFinite(depth) ? depth.toFixed(1) + ' km' : 'No disponible') + '</p><p>Hora: ' + (props.time ? new Date(props.time).toLocaleString() : 'No disponible') + '</p><p>Fuente: USGS</p>';
        const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
        let entity = earthquakeEntities.get(id);
        if (!entity) {
          entity = viewer.entities.add({
            name: 'Sismo M' + magnitude.toFixed(1) + ' · ' + (props.place || 'USGS'),
            position,
            point: {
              pixelSize: Math.max(6, Math.min(18, 5 + magnitude * 2)),
              color: Cesium.Color.fromCssColorString(magnitude >= 5 ? '#fb7185' : '#fbbf24'),
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 1
            },
            description
          });
          earthquakeEntities.set(id, entity);
        } else {
          entity.position = position;
          entity.description = description;
          entity.show = true;
        }
      }
      for (const [id, entity] of earthquakeEntities) {
        if (!current.has(id)) {
          viewer.entities.remove(entity);
          earthquakeEntities.delete(id);
        }
      }
      earthquakes.status.textContent = current.size + ' eventos globales · USGS';
    } catch (error) {
      earthquakes.status.textContent = 'USGS temporalmente no disponible';
      console.warn('USGS feed error', error);
    } finally {
      earthquakeBusy = false;
    }
  }

  // AISStream needs a provider key. It is held in memory and never written to storage.
  const marineCard = document.querySelector('#marine-tools .marine-card');
  const vesselEntities = new Map<string, any>();
  let aisSocket: WebSocket | null = null;
  let aisKey = '';
  let aisReconnect = false;

  if (marineCard && !document.getElementById('ais-api-key')) {
    const note = document.createElement('p');
    note.textContent = 'Conectá un proveedor AIS autorizado con tu propia clave AISStream. La clave permanece solo en memoria durante esta sesión.';
    const input = document.createElement('input');
    input.id = 'ais-api-key';
    input.type = 'password';
    input.autocomplete = 'off';
    input.placeholder = 'Clave personal AISStream';
    input.className = 'search-input';
    input.style.width = '100%';
    input.style.margin = '8px 0';
    const connect = document.createElement('button');
    connect.type = 'button';
    connect.className = 'mini-btn';
    connect.textContent = 'Conectar AIS';
    const status = document.createElement('small');
    status.className = 'coverage-note';
    status.textContent = 'Desconectado · requiere clave del proveedor';
    marineCard.append(note, input, connect, status);

    function startAis() {
      const key = input.value.trim() || aisKey;
      const b = bounds();
      if (!key) {
        status.textContent = 'Ingresá tu clave AISStream para conectar';
        return;
      }
      if (!b || viewer.camera.positionCartographic.height > 12000000) {
        status.textContent = 'Acercá el globo a una región para consultar AIS';
        return;
      }
      aisKey = key;
      if (aisSocket) aisSocket.close();
      status.textContent = 'Conectando al flujo AIS…';
      aisReconnect = true;
      const socket = new WebSocket('wss://stream.aisstream.io/v0/stream');
      aisSocket = socket;
      socket.onopen = () => {
        const area = bounds();
        if (!area) return;
        socket.send(JSON.stringify({
          APIKey: aisKey,
          BoundingBoxes: [[[area.south, area.west], [area.north, area.east]]]
        }));
        status.textContent = 'AIS conectado · región visible';
      };
      socket.onmessage = (event: MessageEvent) => {
        try {
          const message = JSON.parse(String(event.data));
          const report = message.Message?.PositionReport;
          const meta = message.MetaData || {};
          if (!report) return;
          const lat = Number(report.Latitude);
          const lon = Number(report.Longitude);
          const mmsi = String(meta.MMSI || report.UserID || '');
          if (!mmsi || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
          const name = String(meta.ShipName || ('MMSI ' + mmsi)).trim();
          const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
          const speed = Number(report.Sog);
          const course = Number(report.Cog);
          const description = '<b>' + escapeHtml(name) + '</b><p>MMSI: ' + escapeHtml(mmsi) + '</p><p>Velocidad: ' + (Number.isFinite(speed) ? speed + ' nudos' : 'No disponible') + '</p><p>Rumbo: ' + (Number.isFinite(course) ? course + '°' : 'No disponible') + '</p><p>Posición AIS recibida: ' + lat.toFixed(5) + ', ' + lon.toFixed(5) + '</p><p>Fuente: AISStream</p>';
          let entity = vesselEntities.get(mmsi);
          if (!entity) {
            entity = viewer.entities.add({
              name,
              position,
              point: { pixelSize: 8, color: Cesium.Color.fromCssColorString('#38bdf8'), outlineColor: Cesium.Color.WHITE, outlineWidth: 1 },
              label: {
                text: 'BUQUE AIS',
                font: 'bold 9px sans-serif',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -12),
                scaleByDistance: new Cesium.NearFarScalar(50000, 1, 1200000, 0.25)
              },
              description
            });
            vesselEntities.set(mmsi, entity);
          } else {
            entity.name = name;
            entity.position = position;
            entity.description = description;
          }
        } catch (error) {
          console.warn('AIS message parse error', error);
        }
      };
      socket.onerror = () => { status.textContent = 'Error AIS · verificá clave y conexión'; };
      socket.onclose = () => {
        if (aisSocket === socket) aisSocket = null;
        if (aisReconnect) {
          status.textContent = 'AIS desconectado · tocá Conectar para reintentar';
          connect.textContent = 'Conectar AIS';
        }
      };
    }

    connect.addEventListener('click', () => {
      if (aisSocket) {
        aisReconnect = false;
        aisSocket.close();
        aisSocket = null;
        status.textContent = 'AIS desconectado';
        connect.textContent = 'Conectar AIS';
      } else {
        startAis();
        connect.textContent = 'Desconectar';
      }
    });

    viewer.camera.moveEnd.addEventListener(() => {
      if (aisSocket && aisSocket.readyState === WebSocket.OPEN && aisReconnect) {
        aisSocket.close();
        aisSocket = null;
        window.setTimeout(() => {
          if (aisReconnect && !aisSocket) startAis();
        }, 500);
      }
    });
  }

  viewer.camera.moveEnd.addEventListener(() => {
    if (installationsOn) void refreshInstallations(false);
  });
  window.setInterval(() => {
    if (earthquakesOn) void refreshEarthquakes();
  }, 120000);

  return { refreshInstallations, refreshEarthquakes };
}
