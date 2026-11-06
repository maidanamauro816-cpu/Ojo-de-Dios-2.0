import { json2satrec, propagate, gstime, eciToGeodetic, degreesLat, degreesLong } from 'satellite.js';

declare const Cesium: any;

type OmmRecord = Record<string, any>;
type SatelliteRecord = {
  name: string;
  norad: string;
  epoch: string;
  satrec: any;
  point: any;
  groups: Set<string>;
  valid: boolean;
};

export type SatelliteGroup = {
  id: string;
  label: string;
  /** Nombre de GROUP en CelesTrak (gp.php?GROUP=...). */
  group: string;
  color: string;
  size?: number;
  /** Se activa automáticamente al encender la capa de satélites. */
  defaultOn?: boolean;
};

/**
 * Capas orbitales públicas de CelesTrak. El orden define la prioridad de color:
 * un satélite que pertenece a varias capas se pinta con la primera que aparece aquí,
 * y "active" (todos los activos) queda siempre al final.
 */
export const SATELLITE_GROUPS: SatelliteGroup[] = [
  { id: 'stations', label: 'Estaciones espaciales', group: 'stations', color: '#ffffff', size: 9 },
  { id: 'starlink', label: 'Starlink', group: 'starlink', color: '#f2c85b' },
  { id: 'oneweb', label: 'OneWeb', group: 'oneweb', color: '#a78bfa' },
  { id: 'iridium', label: 'Iridium NEXT', group: 'iridium-NEXT', color: '#f472b6' },
  { id: 'gps', label: 'GPS (operativos)', group: 'gps-ops', color: '#4ade80' },
  { id: 'glonass', label: 'GLONASS (operativos)', group: 'glo-ops', color: '#86efac' },
  { id: 'galileo', label: 'Galileo', group: 'galileo', color: '#34d399' },
  { id: 'beidou', label: 'BeiDou', group: 'beidou', color: '#2dd4bf' },
  { id: 'weather', label: 'Meteorológicos', group: 'weather', color: '#60a5fa' },
  { id: 'resource', label: 'Observación de la Tierra', group: 'resource', color: '#38bdf8' },
  { id: 'geo', label: 'Geoestacionarios', group: 'geo', color: '#fb923c' },
  { id: 'science', label: 'Científicos', group: 'science', color: '#c084fc' },
  { id: 'military', label: 'Militares (públicos)', group: 'military', color: '#f87171' },
  { id: 'radar', label: 'Calibración de radar', group: 'radar', color: '#fca5a5' },
  { id: 'amateur', label: 'Radioaficionados', group: 'amateur', color: '#fde047' },
  { id: 'cubesat', label: 'CubeSats', group: 'cubesat', color: '#5eead4' },
  { id: 'planet', label: 'Planet', group: 'planet', color: '#93c5fd' },
  { id: 'spire', label: 'Spire', group: 'spire', color: '#a5b4fc' },
  { id: 'new', label: 'Lanzados últimos 30 días', group: 'last-30-days', color: '#e879f9' },
  { id: 'debris-cosmos2251', label: 'Restos Cosmos 2251', group: 'cosmos-2251-debris', color: '#9ca3af', size: 3 },
  { id: 'debris-iridium33', label: 'Restos Iridium 33', group: 'iridium-33-debris', color: '#9ca3af', size: 3 },
  { id: 'debris-fengyun', label: 'Restos Fengyun-1C', group: 'fengyun-1c-debris', color: '#9ca3af', size: 3 },
  { id: 'debris-cosmos1408', label: 'Restos Cosmos 1408', group: 'cosmos-1408-debris', color: '#9ca3af', size: 3 },
  { id: 'active', label: 'Todos los activos', group: 'active', color: '#48d9ff', defaultOn: true }
];

const CACHE_DB = 'ojo-de-dios-data';
const CACHE_STORE = 'feeds';
const CACHE_TTL = 2 * 60 * 60 * 1000; // CelesTrak GP refreshes every two hours.
const REFRESH_POSITIONS_MS = 15000;
const MAX_RECORDS = 40000;

function openCache(): Promise<IDBDatabase | null> {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(CACHE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function readCache(key: string): Promise<{ savedAt: number; records: OmmRecord[] } | null> {
  const db = await openCache();
  if (!db) return null;
  return new Promise((resolve) => {
    const request = db.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
}

async function writeCache(key: string, records: OmmRecord[]) {
  const db = await openCache();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.objectStore(CACHE_STORE).put({ savedAt: Date.now(), records }, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

const cacheKeyFor = (group: SatelliteGroup) => `celestrak-${group.group}-omm`;

export function createSatelliteLayer({
  viewer,
  Cesium,
  apiBase = '',
  statusElement,
  groupsContainer
}: {
  viewer: any;
  Cesium: any;
  apiBase?: string;
  statusElement?: HTMLElement | null;
  groupsContainer?: HTMLElement | null;
}) {
  const collection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
  const records = new Map<string, SatelliteRecord>();
  const groupEnabled = new Set<string>(SATELLITE_GROUPS.filter((g) => g.defaultOn).map((g) => g.id));
  const groupLoaded = new Set<string>();
  const groupLoading = new Set<string>();
  const groupErrors = new Map<string, string>();
  const groupCounts = new Map<string, HTMLElement>();
  const groupById = new Map(SATELLITE_GROUPS.map((g) => [g.id, g]));
  let enabled = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let selectedEntity: any = null;
  let queue: Promise<void> = Promise.resolve();

  function status(message: string) {
    if (statusElement) {
      statusElement.textContent = message;
      statusElement.hidden = !enabled || !message;
    }
  }

  const isVisibleGroupMember = (item: SatelliteRecord) => {
    for (const id of item.groups) if (groupEnabled.has(id)) return true;
    return false;
  };

  /** Color y tamaño según la capa de mayor prioridad a la que pertenece el satélite. */
  function styleFor(item: SatelliteRecord) {
    for (const group of SATELLITE_GROUPS) {
      if (item.groups.has(group.id)) {
        item.point.color = Cesium.Color.fromCssColorString(group.color);
        item.point.pixelSize = item.name.toUpperCase().includes('ISS') ? 10 : group.size || 5;
        return;
      }
    }
  }

  function updateVisibility() {
    for (const item of records.values()) {
      item.point.show = item.valid && isVisibleGroupMember(item);
    }
  }

  function updatePositions() {
    if (!enabled || !records.size) return;
    const now = new Date();
    const sidereal = gstime(now);
    let shown = 0;
    for (const item of records.values()) {
      if (!isVisibleGroupMember(item)) {
        item.point.show = false;
        continue;
      }
      try {
        const pv = propagate(item.satrec, now);
        if (!pv?.position) {
          item.valid = false;
          item.point.show = false;
          continue;
        }
        const geo = eciToGeodetic(pv.position, sidereal);
        const lat = degreesLat(geo.latitude);
        const lon = degreesLong(geo.longitude);
        const altitudeKm = geo.height;
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(altitudeKm) || altitudeKm < 80) {
          item.valid = false;
          item.point.show = false;
          continue;
        }
        item.point.position = Cesium.Cartesian3.fromDegrees(lon, lat, altitudeKm * 1000);
        item.valid = true;
        item.point.show = true;
        shown++;
      } catch {
        item.valid = false;
        item.point.show = false;
      }
    }
    const active = [...groupEnabled].filter((id) => groupLoaded.has(id)).length;
    status(`SATÉLITES VISIBLES: ${shown.toLocaleString('es-AR')} · CAPAS ACTIVAS: ${active} · SGP4/OMM · CelesTrak`);
  }

  function addRecords(groupId: string, input: OmmRecord[]) {
    let added = 0;
    for (const omm of input) {
      try {
        if (!omm || !omm.OBJECT_NAME || !omm.NORAD_CAT_ID || !omm.EPOCH) continue;
        const norad = String(omm.NORAD_CAT_ID);
        const existing = records.get(norad);
        if (existing) {
          existing.groups.add(groupId);
          styleFor(existing);
          continue;
        }
        if (records.size >= MAX_RECORDS) break;
        const satrec = json2satrec(omm as any);
        if (satrec.error) continue;
        const name = String(omm.OBJECT_NAME).trim();
        const point = collection.add({
          position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
          pixelSize: 5,
          color: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
          outlineWidth: 1,
          show: false,
          id: { source: 'CelesTrak', name, norad, epoch: String(omm.EPOCH) }
        });
        const item: SatelliteRecord = { name, norad, epoch: String(omm.EPOCH), satrec, point, groups: new Set([groupId]), valid: false };
        styleFor(item);
        records.set(norad, item);
        added++;
      } catch {
        // Invalid orbital records are skipped without discarding the catalog.
      }
    }
    return added;
  }

  function setGroupCount(groupId: string, text: string) {
    const node = groupCounts.get(groupId);
    if (node) node.textContent = text;
  }

  async function fetchGroup(group: SatelliteGroup): Promise<OmmRecord[]> {
    // OMM JSON supports modern 6+ digit catalog numbers; legacy TLE does not.
    const apiRoot = String(apiBase || '').replace(/\/+$/, '');
    const directUrl = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group.group)}&FORMAT=JSON`;
    const proxied = group.group === 'active'
      ? `${apiRoot}/api/satellites/active`
      : `${apiRoot}/api/satellites/group/${encodeURIComponent(group.group)}`;
    const urls = apiRoot ? [proxied, directUrl] : [directUrl];
    let fetchError: unknown = null;
    for (const url of urls) {
      try {
        const response = await fetch(url, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(45000)
        });
        if (!response.ok) {
          fetchError = new Error('Catálogo orbital HTTP ' + response.status);
          continue;
        }
        const payload = await response.json();
        if (!Array.isArray(payload)) throw new Error('Formato orbital inesperado');
        return payload;
      } catch (error) {
        fetchError = error;
      }
    }
    throw fetchError || new Error('No se pudo cargar el catálogo orbital');
  }

  async function loadGroup(groupId: string) {
    const group = groupById.get(groupId);
    if (!group || groupLoaded.has(groupId) || groupLoading.has(groupId)) return;
    groupLoading.add(groupId);
    setGroupCount(groupId, '…');
    status(`CARGANDO CAPA: ${group.label.toUpperCase()}…`);
    try {
      const key = cacheKeyFor(group);
      const cached = await readCache(key);
      const fresh = cached && Date.now() - cached.savedAt < CACHE_TTL;
      let payload: OmmRecord[] | null = fresh && cached?.records?.length ? cached.records : null;
      if (!payload) {
        try {
          payload = await fetchGroup(group);
          await writeCache(key, payload);
          groupErrors.delete(groupId);
        } catch (error: any) {
          groupErrors.set(groupId, error?.message || 'Error de red');
          // Con datos viejos en caché es mejor mostrarlos que dejar la capa vacía.
          if (cached?.records?.length) payload = cached.records;
          else throw error;
        }
      }
      addRecords(groupId, payload);
      groupLoaded.add(groupId);
      const count = [...records.values()].filter((item) => item.groups.has(groupId)).length;
      setGroupCount(groupId, count.toLocaleString('es-AR'));
    } catch (error: any) {
      setGroupCount(groupId, 'error');
      status(`SIN DATOS DE ${group.label.toUpperCase()}: ${error?.message || 'error'}`);
    } finally {
      groupLoading.delete(groupId);
      updatePositions();
    }
  }

  // CelesTrak limita consultas repetidas: las capas se piden de a una.
  function enqueueLoad(groupId: string) {
    queue = queue.then(() => loadGroup(groupId)).catch(() => undefined);
    return queue;
  }

  function renderGroups() {
    if (!groupsContainer) return;
    groupsContainer.innerHTML = '';
    groupCounts.clear();
    for (const group of SATELLITE_GROUPS) {
      const row = document.createElement('label');
      row.className = 'sat-group';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = groupEnabled.has(group.id);
      checkbox.addEventListener('change', () => setGroupEnabled(group.id, checkbox.checked));
      const swatch = document.createElement('span');
      swatch.className = 'sat-swatch';
      swatch.style.background = group.color;
      const name = document.createElement('span');
      name.className = 'sat-group-name';
      name.textContent = group.label;
      const count = document.createElement('small');
      count.className = 'sat-group-count';
      groupCounts.set(group.id, count);
      row.append(checkbox, swatch, name, count);
      groupsContainer.append(row);
    }
  }

  function setGroupEnabled(groupId: string, value: boolean) {
    if (!groupById.has(groupId)) return;
    if (value) groupEnabled.add(groupId);
    else groupEnabled.delete(groupId);
    if (value && enabled) void enqueueLoad(groupId);
    updateVisibility();
    updatePositions();
  }

  function onPick(movement: any) {
    if (!enabled) return;
    const picked = viewer.scene.pick(movement.position);
    const data = picked?.id;
    if (!data || data.source !== 'CelesTrak') return;
    if (selectedEntity) viewer.entities.remove(selectedEntity);
    const item = records.get(String(data.norad));
    const position = item?.point?.position;
    if (!item || !position) return;
    const groupLabels = [...item.groups].filter((id) => id !== 'active').map((id) => groupById.get(id)?.label).filter(Boolean);
    const safeName = String(data.name).replace(/[&<>"]/g, '');
    selectedEntity = viewer.entities.add({
      name: data.name,
      position,
      point: { pixelSize: 13, color: Cesium.Color.WHITE, outlineColor: Cesium.Color.fromCssColorString('#f2c85b'), outlineWidth: 3 },
      label: {
        text: `🛰 ${data.name} · NORAD ${data.norad}`,
        font: 'bold 12px sans-serif',
        fillColor: Cesium.Color.fromCssColorString('#f2c85b'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -22),
        disableDepthTestDistance: 10000000
      },
      description: `<strong>${safeName}</strong><br>Número NORAD: ${data.norad}<br>Capas: ${groupLabels.join(', ') || 'Activos'}<br>Fuente orbital: CelesTrak · OMM/SGP4<br>Época de elementos: ${data.epoch}<br><small>Posición calculada a partir de elementos orbitales públicos; no es una medición de radar.</small>`
    });
    viewer.selectedEntity = selectedEntity;
    status(`SELECCIONADO: ${data.name} · NORAD ${data.norad}`);
  }

  const clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  clickHandler.setInputAction(onPick, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  function setEnabled(value: boolean) {
    enabled = Boolean(value);
    collection.show = enabled;
    groupsContainer?.closest<HTMLElement>('[data-sat-panel]')?.toggleAttribute('hidden', !enabled);
    if (selectedEntity) selectedEntity.show = enabled;
    if (enabled) {
      for (const id of groupEnabled) void enqueueLoad(id);
      if (!timer) timer = setInterval(updatePositions, REFRESH_POSITIONS_MS);
      status(records.size ? 'SATÉLITES: ACTUALIZANDO POSICIONES' : 'CONECTANDO CON CATÁLOGO ORBITAL MUNDIAL…');
      updatePositions();
    } else {
      if (timer) clearInterval(timer);
      timer = null;
      status('');
    }
  }

  renderGroups();

  return {
    setEnabled,
    setGroupEnabled,
    refresh: () => Promise.all([...groupEnabled].map((id) => enqueueLoad(id))),
    getGroups: () => SATELLITE_GROUPS.map((g) => ({ ...g, enabled: groupEnabled.has(g.id), loaded: groupLoaded.has(g.id) })),
    getState: () => ({
      enabled,
      count: records.size,
      loading: groupLoading.size > 0,
      error: [...groupErrors.values()][0] || ''
    })
  };
}
