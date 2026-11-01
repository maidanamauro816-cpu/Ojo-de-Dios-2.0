import { twoline2satrec, propagate, gstime, eciToGeodetic, degreesLat, degreesLong } from 'satellite.js';

declare const Cesium: any;

declare global {
  interface Window {
    Cesium: any;
  }
}

interface AircraftData {
  hex: string;
  flight?: string;
  r?: string;
  t?: string;
  lat: number;
  lon: number;
  alt_baro?: number | string;
  alt_geom?: number;
  gs?: number;
  track?: number;
  category?: string;
  seen?: number;
  rssi?: number;
  now?: number;
  squawk?: string;
  ias?: number;
  tas?: number;
  baro_rate?: number;
}

interface AircraftItem {
  data: AircraftData;
  entity: any;
  trail: any;
  trailPositions: any[];
  lastSeen: number;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const hint = $('hint');
const satStatus = $('sat-status');
const fleetStatus = $('fleet-status');
const flightStatus = $('flight-status');
const flightTools = $('flight-tools');
const flightList = $('flight-list');
const flightFilter = $('flight-filter') as HTMLInputElement;
const flightRadius = $('flight-radius') as HTMLSelectElement;
const aircraftDetail = $('aircraft-detail');
const aircraftDetailContent = $('aircraft-detail-content');
const layerActiveCount = $('layer-active-count');
const marineTools = $('marine-tools');
const utcClock = $('utc-clock');
const coordsHud = $('coords');
const altHud = $('altitude-hud');

if (!window.Cesium) {
  if (hint) {
    hint.textContent = 'No se pudo cargar el motor CesiumJS 3D. Verifique su conexión y recargue.';
  }
  throw new Error('CesiumJS CDN unavailable');
}

// Initialize Cesium 3D Viewer
const viewer = new Cesium.Viewer('globe', {
  animation: false,
  timeline: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  baseLayerPicker: false,
  navigationHelpButton: false,
  fullscreenButton: false,
  infoBox: true,
  selectionIndicator: true,
  shouldAnimate: true,
  imageryProvider: false,
  terrainProvider: new Cesium.EllipsoidTerrainProvider()
});

// Set OpenStreetMap Global Imagery
viewer.imageryLayers.removeAll();
viewer.imageryLayers.addImageryProvider(
  new Cesium.UrlTemplateImageryProvider({
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    credit: '© OpenStreetMap contributors',
    maximumLevel: 19
  })
);

viewer.scene.globe.enableLighting = true;
viewer.scene.globe.showGroundAtmosphere = true;
viewer.scene.skyAtmosphere.show = true;
viewer.scene.screenSpaceCameraController.minimumZoomDistance = 800;
viewer.scene.screenSpaceCameraController.maximumZoomDistance = 50000000;

// Set initial vantage point
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(-58.38, -34.60, 18500000),
  orientation: {
    heading: 0,
    pitch: Cesium.Math.toRadians(-90),
    roll: 0
  }
});

// Layer state tracking
const layerStates: Record<string, boolean> = {
  iss: true,
  satellites: false,
  haarp: true,
  strategic: true,
  military: true,
  flights: false,
  ships: false
};

function updateActiveLayerBadge() {
  const activeCount = Object.values(layerStates).filter(Boolean).length;
  if (layerActiveCount) {
    layerActiveCount.textContent = `${activeCount} ACTIVAS`;
  }
}

// HAARP Alaska Entity
const haarp = viewer.entities.add({
  name: 'HAARP · Gakona, Alaska',
  position: Cesium.Cartesian3.fromDegrees(-145.15, 62.39, 100),
  point: {
    pixelSize: 12,
    color: Cesium.Color.ORANGE,
    outlineColor: Cesium.Color.WHITE,
    outlineWidth: 2
  },
  label: {
    text: '📡 HAARP (ALASKA)',
    font: 'bold 12px monospace',
    fillColor: Cesium.Color.fromCssColorString('#fbbf24'),
    outlineColor: Cesium.Color.BLACK,
    outlineWidth: 3,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    pixelOffset: new Cesium.Cartesian2(0, -20),
    scaleByDistance: new Cesium.NearFarScalar(1e5, 1, 1e7, 0.5)
  },
  description: `
    <div style="font-family: sans-serif; color: #1e293b; padding: 4px;">
      <h3 style="margin-bottom: 6px; color: #0f172a;">Instalación de Investigación HAARP</h3>
      <p><b>Ubicación:</b> Gakona, Alaska, EE. UU. (62.39° N, 145.15° W)</p>
      <p><b>Tipo:</b> Centro terrestre de investigación ionosférica y física de plasma de alta frecuencia.</p>
      <p><b>Operador:</b> Universidad de Alaska Fairbanks (originalmente financiado por DARPA/USAF).</p>
      <p style="font-size: 11px; color: #64748b; margin-top: 6px;">Nota de inteligencia: Es una estación terrestre de radiofrecuencia (IRI), no un satélite orbital.</p>
    </div>
  `
});

// Strategic Global Bases
const strategicEntities: any[] = [];
const strategicBases = [
  {
    name: 'CERN · Gran Colisionador de Hadrones',
    lat: 46.233,
    lon: 6.050,
    label: '🔬 CERN (SUIZA)',
    desc: 'Mayor laboratorio de física de partículas del mundo, frontera franco-suiza cerca de Ginebra.'
  },
  {
    name: 'Bóveda Global de Semillas de Svalbard',
    lat: 78.238,
    lon: 15.448,
    label: '🌱 SVALBARD VAULT',
    desc: 'Bóveda de seguridad global en el archipiélago ártico de Svalbard (Noruega).'
  },
  {
    name: 'Centro Espacial Kennedy (KSC / NASA)',
    lat: 28.573,
    lon: -80.649,
    label: '🚀 KSC · CABO CAÑAVERAL',
    desc: 'Puerto espacial primario de la NASA para misiones tripuladas e interplanetarias en Florida.'
  },
  {
    name: 'Observatorio de Radioastronomía ALMA',
    lat: -23.023,
    lon: -67.754,
    label: '🔭 ALMA (CHILE)',
    desc: 'Atacama Large Millimeter/submillimeter Array en el llano de Chajnantor a 5000 m de altitud.'
  }
];

strategicBases.forEach((base) => {
  const ent = viewer.entities.add({
    name: base.name,
    position: Cesium.Cartesian3.fromDegrees(base.lon, base.lat, 100),
    point: {
      pixelSize: 10,
      color: Cesium.Color.fromCssColorString('#a855f7'),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2
    },
    label: {
      text: base.label,
      font: 'bold 11px monospace',
      fillColor: Cesium.Color.fromCssColorString('#c084fc'),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -18),
      scaleByDistance: new Cesium.NearFarScalar(1e5, 1, 1e7, 0.45)
    },
    description: `
      <div style="font-family: sans-serif; color: #1e293b; padding: 4px;">
        <h3 style="margin-bottom: 6px; color: #0f172a;">${base.name}</h3>
        <p>${base.desc}</p>
        <p><b>Coordenadas:</b> ${base.lat.toFixed(4)}°, ${base.lon.toFixed(4)}°</p>
      </div>
    `
  });
  strategicEntities.push(ent);
});


// Military, naval and air bases — well-known, publicly documented installations
// (public coordinates and names, same category as any atlas or Wikipedia entry;
// static labels only, no live feeds, troop data or operational intelligence).
const militaryEntities: any[] = [];
const militaryBases = [
  { name: 'Pentágono', lat: 38.8719, lon: -77.0563, label: '🏛️ PENTÁGONO (EE. UU.)', kind: 'Mando', desc: 'Sede del Departamento de Defensa de los Estados Unidos, Arlington, Virginia.' },
  { name: 'NORAD · Cheyenne Mountain', lat: 38.7446, lon: -104.8453, label: '🏔️ NORAD (COLORADO)', kind: 'Mando', desc: 'Centro de operaciones de defensa aeroespacial de Norteamérica, excavado en la montaña Cheyenne.' },
  { name: 'Base Aérea de Ramstein', lat: 49.4369, lon: 7.6003, label: '✈️ RAMSTEIN (ALEMANIA)', kind: 'Base aérea', desc: 'Principal base aérea de EE. UU. en Europa; sede del Mando Aéreo de EE. UU. en Europa (USAFE).' },
  { name: 'Base Aérea RAF Lakenheath', lat: 52.4092, lon: 0.5606, label: '✈️ RAF LAKENHEATH (REINO UNIDO)', kind: 'Base aérea', desc: 'Base aérea de la Real Fuerza Aérea británica operada por la USAF en Suffolk, Inglaterra.' },
  { name: 'Base Aérea de Edwards', lat: 34.9054, lon: -117.8837, label: '✈️ EDWARDS (CALIFORNIA)', kind: 'Base aérea', desc: 'Centro de pruebas de vuelo de la Fuerza Aérea de EE. UU. en el desierto de Mojave.' },
  { name: 'Base de Creech', lat: 36.5822, lon: -115.6711, label: '✈️ CREECH (NEVADA)', kind: 'Base aérea', desc: 'Base de la Fuerza Aérea de EE. UU. en Nevada, conocida por operaciones de aeronaves no tripuladas.' },
  { name: 'Base Aeronaval de Norfolk', lat: 36.9381, lon: -76.3058, label: '⚓ NORFOLK (VIRGINIA)', kind: 'Base naval', desc: 'La base naval más grande del mundo por personal embarcado, en Virginia, EE. UU.' },
  { name: 'Base Naval de Yokosuka', lat: 35.2928, lon: 139.6689, label: '⚓ YOKOSUKA (JAPÓN)', kind: 'Base naval', desc: 'Base principal de la Séptima Flota de la Marina de los EE. UU. en Japón.' },
  { name: 'Base Naval de Guantánamo', lat: 19.9015, lon: -75.1430, label: '⚓ GUANTÁNAMO (CUBA)', kind: 'Base naval', desc: 'Base naval de EE. UU. en el sureste de Cuba, en funcionamiento desde 1903.' },
  { name: 'Base Naval de Rota', lat: 36.6208, lon: -6.3496, label: '⚓ ROTA (ESPAÑA)', kind: 'Base naval', desc: 'Base naval hispano-estadounidense en la bahía de Cádiz, España.' },
  { name: 'Base Naval y Aérea de Diego García', lat: -7.3133, lon: 72.4111, label: '🏝️ DIEGO GARCÍA (OCÉANO ÍNDICO)', kind: 'Base conjunta', desc: 'Base naval y aérea conjunta de Reino Unido y EE. UU. en el atolón de Diego García.' },
  { name: 'Base Naval de Rostock-Hohe Düne', lat: 54.1807, lon: 12.1356, label: '⚓ ROSTOCK (ALEMANIA)', kind: 'Base naval', desc: 'Principal base naval de la Marina alemana en el Báltico.' },
  { name: 'Base Naval de Toulon', lat: 43.1047, lon: 5.9178, label: '⚓ TOULON (FRANCIA)', kind: 'Base naval', desc: 'Principal base de la Marina Nacional francesa en el Mediterráneo.' },
  { name: 'Base Aérea Edmund Hillary (McMurdo)', lat: -77.8419, lon: 166.6863, label: '❄️ McMURDO (ANTÁRTIDA)', kind: 'Base conjunta', desc: 'Principal estación e instalación logística de EE. UU. en la Antártida.' },
  { name: 'Base Conjunta de Baumholder', lat: 49.6372, lon: 7.3375, label: '🪖 BAUMHOLDER (ALEMANIA)', kind: 'Base terrestre', desc: 'Guarnición del Ejército de EE. UU. en Renania-Palatinado, Alemania.' },
  { name: 'Fuerte Bragg (Fort Liberty)', lat: 35.1415, lon: -79.0060, label: '🪖 FORT LIBERTY (CAROLINA DEL NORTE)', kind: 'Base terrestre', desc: 'Una de las mayores instalaciones militares del Ejército de EE. UU., en Carolina del Norte.' },
  { name: 'Base Aérea de Groom Lake (Área 51)', lat: 37.2431, lon: -115.7930, label: '🛩️ ÁREA 51 (NEVADA)', kind: 'Base aérea', desc: 'Instalación de pruebas de vuelo de la Fuerza Aérea de EE. UU. en el desierto de Nevada.' },
  { name: 'Base Aeronaval de Puerto Belgrano', lat: -38.9108, lon: -62.1050, label: '⚓ PUERTO BELGRANO (ARGENTINA)', kind: 'Base naval', desc: 'Principal base naval de la Armada Argentina, en Punta Alta, provincia de Buenos Aires.' },
  { name: 'Base Aérea Militar de Río Cuarto', lat: -33.0794, lon: -64.2611, label: '✈️ RÍO CUARTO (ARGENTINA)', kind: 'Base aérea', desc: 'Base de la IV Brigada Aérea de la Fuerza Aérea Argentina, en Córdoba.' }
];

const militaryColor = (kind: string) => {
  if (kind === 'Base naval') return '#22d3ee';
  if (kind === 'Base aérea') return '#fbbf24';
  if (kind === 'Mando') return '#f87171';
  return '#94a3b8';
};

militaryBases.forEach((base) => {
  const color = militaryColor(base.kind);
  const ent = viewer.entities.add({
    name: base.name,
    position: Cesium.Cartesian3.fromDegrees(base.lon, base.lat, 100),
    point: {
      pixelSize: 9,
      color: Cesium.Color.fromCssColorString(color),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 1.5
    },
    label: {
      text: base.label,
      font: 'bold 10px monospace',
      fillColor: Cesium.Color.fromCssColorString(color),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -17),
      scaleByDistance: new Cesium.NearFarScalar(1e5, 1, 1e7, 0.4)
    },
    description: `
      <div style="font-family: sans-serif; color: #1e293b; padding: 4px;">
        <h3 style="margin-bottom: 6px; color: #0f172a;">${base.name}</h3>
        <p><b>Tipo:</b> ${base.kind}</p>
        <p>${base.desc}</p>
        <p><b>Coordenadas:</b> ${base.lat.toFixed(4)}°, ${base.lon.toFixed(4)}°</p>
        <p style="font-size: 11px; color: #64748b; margin-top: 6px;">Instalación de ubicación públicamente documentada. No se muestra actividad, personal ni movimientos en tiempo real.</p>
      </div>
    `
  });
  militaryEntities.push(ent);
});

// Satellite orbital state
interface SatTracker {
  id: string;
  name: string;
  color: any;
  colorHex: string;
  tle: any | null;
  entity: any | null;
}

const satTrackers: Record<string, SatTracker> = {
  iss: {
    id: 'iss',
    name: 'ISS · Estación Espacial Internacional',
    color: Cesium.Color.LIME,
    colorHex: '#22c55e',
    tle: null,
    entity: null
  },
  tiangong: {
    id: 'tiangong',
    name: 'Tiangong · Estación Espacial China',
    color: Cesium.Color.fromCssColorString('#38bdf8'),
    colorHex: '#38bdf8',
    tle: null,
    entity: null
  },
  hubble: {
    id: 'hubble',
    name: 'Telescopio Espacial Hubble (HST)',
    color: Cesium.Color.fromCssColorString('#f43f5e'),
    colorHex: '#f43f5e',
    tle: null,
    entity: null
  }
};

// Catálogo NORAD (CelesTrak) y un TLE de respaldo por si la red o el navegador bloquean la consulta en vivo.
const SAT_CATALOG: Record<string, { catnr: string; fallbackTle: string }> = {
  iss: {
    catnr: '25544',
    fallbackTle: '1 25544U 98067A   24305.54583333  .00016717  00000+0  30000-3 0  9993\n2 25544  51.6415 160.7123 0005845 125.4521 234.6712 15.49815340478912'
  },
  tiangong: {
    catnr: '48274',
    fallbackTle: '1 48274U 21035A   24305.51234567  .00012345  00000+0  20000-3 0  9991\n2 48274  41.4723 182.3456 0003412 145.2134 214.8123 15.60234120194812'
  },
  hubble: {
    catnr: '20580',
    fallbackTle: '1 20580U 90037B   24305.48912345  .00001524  00000+0  65000-4 0  9997\n2 20580  28.4691 112.5482 0002874  98.4123 261.7123 15.08912340854215'
  }
};

async function loadSatelliteTle(satId: string) {
  const conf = SAT_CATALOG[satId];
  if (!conf) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${conf.catnr}&FORMAT=tle`, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = (await res.text()).trim();
    const lines = text.split(/\r?\n/);
    const one = lines.find((x: string) => x.startsWith('1 '));
    const two = lines.find((x: string) => x.startsWith('2 '));
    if (!one || !two) throw new Error('TLE format mismatch');

    satTrackers[satId].tle = twoline2satrec(one, two);
    if (satId === 'iss') {
      satStatus.textContent = 'ISS · Órbita activa (TLE actualizado)';
    } else if (satId === 'tiangong') {
      fleetStatus.textContent = 'Flota activa · Tiangong & Hubble online';
    }
  } catch (err: any) {
    console.warn(`TLE load error for ${satId}:`, err);
    // Sin red o CORS bloqueado: igual mostramos una órbita aproximada con el TLE de respaldo.
    satTrackers[satId].tle = twoline2satrec(...(conf.fallbackTle.split(/\r?\n/) as [string, string]));
    if (satId === 'iss') {
      satStatus.textContent = 'ISS · Órbita aproximada (sin conexión en vivo)';
    }
  }
}

function updateSatellites() {
  const now = new Date();
  const gtime = gstime(now);

  for (const [key, sat] of Object.entries(satTrackers)) {
    if (!sat.tle) continue;

    const isVisible = key === 'iss' ? layerStates.iss : layerStates.satellites;

    try {
      const pv = propagate(sat.tle, now);
      if (!pv.position || typeof pv.position === 'boolean') continue;

      const geo = eciToGeodetic(pv.position, gtime);
      const lon = degreesLong(geo.longitude);
      const lat = degreesLat(geo.latitude);
      const altMeters = geo.height * 1000;

      const pos = Cesium.Cartesian3.fromDegrees(lon, lat, altMeters);

      if (!sat.entity) {
        sat.entity = viewer.entities.add({
          name: sat.name,
          position: pos,
          point: {
            pixelSize: key === 'iss' ? 12 : 9,
            color: sat.color,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2
          },
          label: {
            text: key === 'iss' ? '🛰 ISS' : `🛰 ${sat.name.split(' · ')[0]}`,
            font: 'bold 12px monospace',
            fillColor: sat.color,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -18)
          },
          description: `
            <div style="font-family: sans-serif; color: #1e293b; padding: 4px;">
              <h3 style="margin-bottom: 6px; color: #0f172a;">${sat.name}</h3>
              <p><b>Altitud orbital:</b> ${Math.round(geo.height)} km</p>
              <p><b>Coordenadas sub-satelitales:</b> ${lat.toFixed(4)}°, ${lon.toFixed(4)}°</p>
              <p style="font-size: 11px; color: #64748b; margin-top: 6px;">Propagación orbital en tiempo real a través de modelo SGP4 y TLE NORAD públicos de CelesTrak.</p>
            </div>
          `
        });
      } else {
        sat.entity.position = pos;
      }
      sat.entity.show = isVisible;
    } catch (e) {
      console.warn(`Error updating sat ${key}:`, e);
    }
  }
}

// ADS-B Flight Tracking Radar
let flightsEnabled = false;
let flightBusy = false;
let lastFlightQuery = 0;
const aircraftMap = new Map<string, AircraftItem>();
const FLIGHT_REFRESH_MS = 12000;
const MAX_TRAIL_POINTS = 35;
const metadataCache = new Map<string, { metadata: any; route: any }>();
let selectedAircraftId: string | null = null;
let currentFilterText = '';

function getGlobeCenter(): { lat: number; lon: number } {
  const canvas = viewer.scene.canvas;
  const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  let point = viewer.camera.pickEllipsoid(center, viewer.scene.globe.ellipsoid);
  if (!point) point = Cesium.Cartesian3.fromDegrees(-58.38, -34.60, 0);
  const geo = Cesium.Cartographic.fromCartesian(point);
  return {
    lat: Cesium.Math.toDegrees(geo.latitude),
    lon: Cesium.Math.toDegrees(geo.longitude)
  };
}

function safeText(value: any, fallback = 'No disponible'): string {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] || ch));
}

function upsertAircraft(a: AircraftData) {
  if (!a.hex || !Number.isFinite(a.lat) || !Number.isFinite(a.lon)) return;
  const id = String(a.hex).toLowerCase();
  const altFeet = typeof a.alt_baro === 'number' ? a.alt_baro : (typeof a.alt_geom === 'number' ? a.alt_geom : 10000);
  const altMeters = Math.max(100, Number(altFeet) * 0.3048);
  const position = Cesium.Cartesian3.fromDegrees(a.lon, a.lat, altMeters);

  if (aircraftMap.has(id)) {
    const item = aircraftMap.get(id)!;
    item.data = a;
    item.lastSeen = Date.now();
    item.entity.position = position;

    item.trailPositions.push(position);
    if (item.trailPositions.length > MAX_TRAIL_POINTS) {
      item.trailPositions.shift();
    }
  } else {
    const trailPositions = [position];
    const callsign = (a.flight || '').trim() || id.toUpperCase();

    const entity = viewer.entities.add({
      name: `Vuelo ${callsign} (${id.toUpperCase()})`,
      position: position,
      point: {
        pixelSize: 8,
        color: Cesium.Color.fromCssColorString('#38bdf8'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 1.5
      },
      label: {
        text: `✈ ${callsign}`,
        font: 'bold 11px monospace',
        fillColor: Cesium.Color.fromCssColorString('#38bdf8'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -16),
        scaleByDistance: new Cesium.NearFarScalar(5e4, 1, 5e6, 0.4)
      }
    });

    const trail = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => trailPositions, false),
        width: 2,
        material: Cesium.Color.fromCssColorString('rgba(56, 189, 248, 0.7)')
      }
    });

    aircraftMap.set(id, {
      data: a,
      entity,
      trail,
      trailPositions,
      lastSeen: Date.now()
    });
  }
}

function renderFlightList() {
  if (!flightList) return;
  const filter = currentFilterText.trim().toLowerCase();

  const matching: AircraftItem[] = [];
  for (const item of aircraftMap.values()) {
    const callsign = (item.data.flight || '').toLowerCase();
    const hex = item.data.hex.toLowerCase();
    const reg = (item.data.r || '').toLowerCase();
    const model = (item.data.t || '').toLowerCase();

    if (!filter || callsign.includes(filter) || hex.includes(filter) || reg.includes(filter) || model.includes(filter)) {
      matching.push(item);
    }
  }

  if (matching.length === 0) {
    flightList.innerHTML = `<span class="muted">${filter ? 'Sin resultados para la búsqueda' : 'No se detectaron aeronaves en el radio actual'}</span>`;
    return;
  }

  let html = '';
  matching.slice(0, 50).forEach((item) => {
    const a = item.data;
    const callsign = (a.flight || '').trim() || 'SIN INDICATIVO';
    const alt = typeof a.alt_baro === 'number' ? `${Math.round(a.alt_baro).toLocaleString()} ft` : (a.alt_baro || '--');
    const speed = typeof a.gs === 'number' ? `${Math.round(a.gs)} kt` : '--';
    const isSelected = selectedAircraftId === a.hex;

    html += `
      <button class="flight-row ${isSelected ? 'selected' : ''}" data-hex="${a.hex}">
        <span class="flight-dot"></span>
        <div class="flight-row-main">
          <strong>${safeText(callsign)} · <span style="color:#38bdf8">${safeText(a.hex.toUpperCase())}</span></strong>
          <small>${safeText(a.t, 'Tipo desconocido')} | Alt: ${alt} | Vel: ${speed}</small>
        </div>
        <span class="flight-arrow">›</span>
      </button>
    `;
  });

  flightList.innerHTML = html;

  flightList.querySelectorAll('.flight-row').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hex = btn.getAttribute('data-hex');
      if (hex) selectFlight(hex);
    });
  });
}

function detailRow(label: string, value: any): string {
  if (value === undefined || value === null || value === '') return '';
  return `<div class="detail-row"><span>${label}</span><b>${safeText(value)}</b></div>`;
}

function renderAircraftDetail(item: AircraftItem, metadata: any, route: any, loading: boolean) {
  if (!aircraftDetail || !aircraftDetailContent) return;
  const a = item.data;

  const origin = route?.origin ? `${route.origin.name || route.origin.icao || ''} ${route.origin.iata ? `(${route.origin.iata})` : ''}` : '';
  const destination = route?.destination ? `${route.destination.name || route.destination.icao || ''} ${route.destination.iata ? `(${route.destination.iata})` : ''}` : '';
  const operator = metadata?.registered_owner || metadata?.registeredOwners || metadata?.operator_flag_code || 'No publicado';
  const manufacturer = metadata?.manufacturer || metadata?.Manufacturer;
  const model = metadata?.type || metadata?.Type || a.t || 'No especificado';
  const reg = a.r || metadata?.registration;
  const alt = typeof a.alt_baro === 'number' ? `${Math.round(a.alt_baro).toLocaleString()} ft` : a.alt_baro;
  const speed = typeof a.gs === 'number' ? `${Math.round(a.gs)} nudos (${Math.round(a.gs * 1.852)} km/h)` : 'No disponible';
  const heading = typeof a.track === 'number' ? `${Math.round(a.track)}°` : 'No disponible';

  aircraftDetailContent.innerHTML = `
    <div class="detail-title">${safeText((a.flight || '').trim(), 'SIN INDICATIVO')}</div>
    <div class="detail-subtitle">ICAO 24-bit: ${safeText(a.hex.toUpperCase())} ${reg ? `· Matrícula: ${safeText(reg)}` : ''}</div>

    <div class="detail-section-title">IDENTIFICACIÓN & OPERADOR</div>
    ${detailRow('Aerolínea / Propietario', operator)}
    ${detailRow('Fabricante', manufacturer)}
    ${detailRow('Modelo aeronave', model)}
    ${detailRow('País de registro', metadata?.country || metadata?.country_code)}
    ${detailRow('Año fabricación', metadata?.year || metadata?.built)}

    <div class="detail-section-title">TELEMETRÍA EN VIVO</div>
    ${detailRow('Altitud barométrica', alt)}
    ${detailRow('Velocidad sobre tierra (GS)', speed)}
    ${detailRow('Rumbo (Track)', heading)}
    ${detailRow('Transpondedor (Squawk)', a.squawk)}
    ${detailRow('Categoría ADS-B', a.category)}
    ${detailRow('Latitud / Longitud', `${Number(a.lat).toFixed(4)}°, ${Number(a.lon).toFixed(4)}°`)}

    <div class="detail-section-title">PLAN DE VUELO PÚBLICO</div>
    ${detailRow('Aeropuerto Origen', origin)}
    ${detailRow('Aeropuerto Destino', destination)}

    ${loading ? '<div class="detail-loading">⚡ Consultando registro internacional hexdb.io...</div>' : ''}
  `;

  aircraftDetail.hidden = false;
}

async function enrichAircraft(id: string, item: AircraftItem) {
  if (metadataCache.has(id)) {
    const cached = metadataCache.get(id)!;
    renderAircraftDetail(item, cached.metadata, cached.route, false);
    return;
  }

  renderAircraftDetail(item, null, null, true);
  const callsign = (item.data.flight || '').trim();

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    const reqs: Promise<Response>[] = [fetch(`https://hexdb.io/api/v2/aircraft/${encodeURIComponent(id)}`, { signal: ctrl.signal })];
    if (callsign) reqs.push(fetch(`https://hexdb.io/api/v2/routes/${encodeURIComponent(callsign)}`, { signal: ctrl.signal }));
    const settled = await Promise.allSettled(reqs);
    clearTimeout(timer);
    const aircraft = settled[0].status === 'fulfilled' && settled[0].value.ok ? await settled[0].value.json() : null;
    const route = settled[1]?.status === 'fulfilled' && settled[1].value.ok ? await settled[1].value.json() : null;
    const data = { aircraft, route };
    metadataCache.set(id, { metadata: data.aircraft, route: data.route });

    if (selectedAircraftId === id && aircraftMap.has(id)) {
      renderAircraftDetail(aircraftMap.get(id)!, data.aircraft, data.route, false);
    }
  } catch (err) {
    console.warn('Enrichment unavailable:', err);
    if (selectedAircraftId === id) {
      renderAircraftDetail(item, null, null, false);
    }
  }
}

function selectFlight(id: string) {
  const item = aircraftMap.get(id);
  if (!item) return;

  selectedAircraftId = id;
  viewer.selectedEntity = item.entity;
  viewer.flyTo(item.entity, {
    duration: 1.5,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-35), 350000)
  });

  renderAircraftDetail(item, null, null, true);
  enrichAircraft(id, item);
  renderFlightList();
}

async function loadFlights(force = false) {
  if (!flightsEnabled || flightBusy) return;
  if (!force && Date.now() - lastFlightQuery < FLIGHT_REFRESH_MS) return;

  flightBusy = true;
  flightStatus.textContent = 'Escaneando radar ADS-B…';

  try {
    const center = getGlobeCenter();
    const radius = flightRadius?.value || '250';
    const url = `https://api.adsb.lol/v2/lat/${center.lat.toFixed(4)}/lon/${center.lon.toFixed(4)}/dist/${radius}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (Array.isArray(data.ac)) {
      data.ac.forEach(upsertAircraft);
      flightStatus.textContent = `${data.ac.length} aeronaves detectadas · Live`;
    }

    lastFlightQuery = Date.now();
    renderFlightList();

    // Remove expired aircraft older than 3 mins
    const now = Date.now();
    for (const [id, item] of aircraftMap) {
      if (now - item.lastSeen > 180000) {
        viewer.entities.remove(item.entity);
        viewer.entities.remove(item.trail);
        aircraftMap.delete(id);
      }
    }
    renderFlightList();
  } catch (err: any) {
    console.warn('ADS-B scan error:', err);
    flightStatus.textContent = 'En espera de radar';
  } finally {
    flightBusy = false;
  }
}

function setFlightsEnabled(enabled: boolean) {
  flightsEnabled = enabled;
  layerStates.flights = enabled;
  flightTools.hidden = !enabled;

  if (enabled) {
    loadFlights(true);
    hint.textContent = 'Buscando aeronaves ADS-B en tiempo real alrededor del centro de observación...';
  } else {
    flightStatus.textContent = 'Desactivado · clic para conectar';
    for (const item of aircraftMap.values()) {
      item.entity.show = false;
      item.trail.show = false;
    }
  }

  if (enabled) {
    for (const item of aircraftMap.values()) {
      item.entity.show = true;
      item.trail.show = true;
    }
  }
  updateActiveLayerBadge();
}

// UI Event Listeners
document.querySelectorAll('[data-layer]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const layer = (btn as HTMLElement).dataset.layer;
    if (!layer) return;

    if (layer === 'iss') {
      layerStates.iss = !layerStates.iss;
      if (satTrackers.iss.entity) satTrackers.iss.entity.show = layerStates.iss;
      btn.classList.toggle('active', layerStates.iss);
      btn.querySelector('.layer-state')!.textContent = layerStates.iss ? 'ON' : 'OFF';
    } else if (layer === 'satellites') {
      layerStates.satellites = !layerStates.satellites;
      if (!satTrackers.tiangong.tle) {
        loadSatelliteTle('tiangong');
        loadSatelliteTle('hubble');
      }
      btn.classList.toggle('active', layerStates.satellites);
      btn.querySelector('.layer-state')!.textContent = layerStates.satellites ? 'ON' : 'OFF';
      updateSatellites();
    } else if (layer === 'haarp') {
      layerStates.haarp = !layerStates.haarp;
      haarp.show = layerStates.haarp;
      btn.classList.toggle('active', layerStates.haarp);
      btn.querySelector('.layer-state')!.textContent = layerStates.haarp ? 'ON' : 'OFF';
    } else if (layer === 'strategic') {
      layerStates.strategic = !layerStates.strategic;
      strategicEntities.forEach((ent) => (ent.show = layerStates.strategic));
      btn.classList.toggle('active', layerStates.strategic);
      btn.querySelector('.layer-state')!.textContent = layerStates.strategic ? 'ON' : 'OFF';
    } else if (layer === 'flights') {
      const next = !layerStates.flights;
      setFlightsEnabled(next);
      btn.classList.toggle('active', next);
      btn.querySelector('.layer-state')!.textContent = next ? 'ON' : 'OFF';
    } else if (layer === 'military') {
      layerStates.military = !layerStates.military;
      militaryEntities.forEach((ent) => (ent.show = layerStates.military));
      btn.classList.toggle('active', layerStates.military);
      btn.querySelector('.layer-state')!.textContent = layerStates.military ? 'ON' : 'OFF';
    } else if (layer === 'ships') {
      layerStates.ships = !layerStates.ships;
      if (marineTools) marineTools.hidden = !layerStates.ships;
      btn.classList.toggle('active', layerStates.ships);
      btn.querySelector('.layer-state')!.textContent = layerStates.ships ? 'ON' : 'OFF';
    }
    updateActiveLayerBadge();
  });
});

// Barra inferior: reutiliza exactamente los controles de capa existentes.\ndocument.querySelectorAll('[data-shortcut-layer]').forEach((shortcut) => {\n  shortcut.addEventListener('click', () => {\n    const layer = (shortcut as HTMLElement).dataset.shortcutLayer;\n    if (!layer) return;\n    const original = document.querySelector<HTMLElement>(\`#main-panel [data-layer="\${layer}"]\`);\n    if (original) original.click();\n    document.querySelectorAll<HTMLElement>(\`[data-shortcut-layer="\${layer}"]\`).forEach((item) => {\n      const active = layer === 'cameras' ? layerStates.cameras : layerStates[layer] ?? false;\n      item.classList.toggle('active', active);\n      item.setAttribute('aria-pressed', String(active));\n    });\n  });\n});\n\n// Search and radius controls
if (flightFilter) {
  flightFilter.addEventListener('input', (e) => {
    currentFilterText = (e.target as HTMLInputElement).value;
    renderFlightList();
  });
}

$('refresh-flights')?.addEventListener('click', () => loadFlights(true));

flightRadius?.addEventListener('change', () => {
  if (flightsEnabled) loadFlights(true);
});

$('close-detail')?.addEventListener('click', () => {
  if (aircraftDetail) aircraftDetail.hidden = true;
  selectedAircraftId = null;
  renderFlightList();
});

// Jump preset selector
const jumpPreset = $('jump-preset') as HTMLSelectElement;
jumpPreset?.addEventListener('change', () => {
  const val = jumpPreset.value;
  if (!val) return;
  const [lat, lon, height] = val.split(',').map(Number);
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-75),
      roll: 0
    },
    duration: 2.0
  });
});

// Sun lighting toggle
let sunEnabled = true;
$('toggle-sun')?.addEventListener('click', () => {
  sunEnabled = !sunEnabled;
  viewer.scene.globe.enableLighting = sunEnabled;
  hint.textContent = sunEnabled ? 'Iluminación solar y ciclo día/noche activados.' : 'Iluminación global uniforme activada.';
});

// Orbit reset
$('reset-cam')?.addEventListener('click', () => {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(-58.38, -34.60, 22000000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 1.8
  });
});

// Camera move listener to reload flights
viewer.camera.moveEnd.addEventListener(() => {
  if (flightsEnabled) {
    loadFlights(true);
  }
  updateHudCoords();
});

function updateHudCoords() {
  const center = getGlobeCenter();
  if (coordsHud) {
    coordsHud.textContent = `CENTRO: ${center.lat >= 0 ? `${center.lat.toFixed(2)}°N` : `${Math.abs(center.lat).toFixed(2)}°S`}, ${center.lon >= 0 ? `${center.lon.toFixed(2)}°E` : `${Math.abs(center.lon).toFixed(2)}°W`}`;
  }
  if (altHud) {
    const camHeight = viewer.camera.positionCartographic.height / 1000;
    altHud.textContent = `ALT: ${camHeight > 1000 ? `${(camHeight / 1000).toFixed(1)}k km` : `${Math.round(camHeight)} km`}`;
  }
}

// Update clock every second
function updateClock() {
  if (utcClock) {
    const d = new Date();
    utcClock.textContent = `${d.toISOString().slice(11, 19)} UTC`;
  }
}

// 3D entity picking on globe
const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
handler.setInputAction((movement: any) => {
  const pickedObject = viewer.scene.pick(movement.position);
  if (Cesium.defined(pickedObject) && pickedObject.id) {
    const ent = pickedObject.id;
    for (const [id, item] of aircraftMap) {
      if (item.entity === ent) {
        selectFlight(id);
        break;
      }
    }
  }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// Mouse move coordinate readout
handler.setInputAction((movement: any) => {
  const ray = viewer.camera.getPickRay(movement.endPosition);
  if (!ray) return;
  const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
  if (!cartesian) return;
  const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
  const lat = Cesium.Math.toDegrees(cartographic.latitude);
  const lon = Cesium.Math.toDegrees(cartographic.longitude);
  if (coordsHud) {
    coordsHud.textContent = `CURSOR: ${lat >= 0 ? `${lat.toFixed(2)}°N` : `${Math.abs(lat).toFixed(2)}°S`}, ${lon >= 0 ? `${lon.toFixed(2)}°E` : `${Math.abs(lon).toFixed(2)}°W`}`;
  }
}, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

// Initialize orbital data and clocks
setInterval(updateClock, 1000);
updateClock();
loadSatelliteTle('iss').then(updateSatellites);
setInterval(updateSatellites, 2000);
setInterval(() => loadSatelliteTle('iss'), 15 * 60 * 1000);
setInterval(() => loadFlights(false), FLIGHT_REFRESH_MS);
updateActiveLayerBadge();
updateHudCoords();
