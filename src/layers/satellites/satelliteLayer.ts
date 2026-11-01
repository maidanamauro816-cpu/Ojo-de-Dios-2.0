import { json2satrec, propagate, gstime, eciToGeodetic, degreesLat, degreesLong } from 'satellite.js';

declare const Cesium: any;

type OmmRecord = Record<string, any>;
type SatelliteRecord = { name: string; norad: string; satrec: any; point: any };

const CACHE_DB = 'ojo-de-dios-data';
const CACHE_STORE = 'feeds';
const CACHE_KEY = 'celestrak-active-omm';
const CACHE_TTL = 2 * 60 * 60 * 1000; // CelesTrak GP refreshes every two hours.
const REFRESH_POSITIONS_MS = 15000;
const MAX_RECORDS = 25000;

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

async function readCache(): Promise<{ savedAt: number; records: OmmRecord[] } | null> {
  const db = await openCache();
  if (!db) return null;
  return new Promise((resolve) => {
    const request = db.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).get(CACHE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
}

async function writeCache(records: OmmRecord[]) {
  const db = await openCache();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.objectStore(CACHE_STORE).put({ savedAt: Date.now(), records }, CACHE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export function createSatelliteLayer({ viewer, Cesium, apiBase = '', statusElement }: { viewer: any; Cesium: any; apiBase?: string; statusElement?: HTMLElement | null }) {
  const collection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
  const records: SatelliteRecord[] = [];
  let enabled = false;
  let loading = false;
  let lastError = '';
  let timer: ReturnType<typeof setInterval> | null = null;
  let selectedEntity: any = null;

  function status(message: string) {
    if (statusElement) {
      statusElement.textContent = message;
      statusElement.hidden = !enabled;
    }
  }

  function satelliteColor(name: string) {
    const value = name.toUpperCase();
    if (value.includes('STARLINK')) return Cesium.Color.fromCssColorString('#f2c85b');
    if (value.includes('ONEWEB')) return Cesium.Color.fromCssColorString('#a78bfa');
    if (value.includes('GPS') || value.includes('NAVSTAR') || value.includes('GALILEO') || value.includes('GLONASS')) {
      return Cesium.Color.fromCssColorString('#4ade80');
    }
    return Cesium.Color.fromCssColorString('#48d9ff');
  }

  function updatePositions() {
    if (!enabled || !records.length) return;
    const now = new Date();
    const sidereal = gstime(now);
    let updated = 0;
    for (const item of records) {
      try {
        const pv = propagate(item.satrec, now);
        if (!pv?.position) {
          item.point.show = false;
          continue;
        }
        const geo = eciToGeodetic(pv.position, sidereal);
        const lat = degreesLat(geo.latitude);
        const lon = degreesLong(geo.longitude);
        const altitudeKm = geo.height;
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(altitudeKm) || altitudeKm < 80) {
          item.point.show = false;
          continue;
        }
        item.point.position = Cesium.Cartesian3.fromDegrees(lon, lat, altitudeKm * 1000);
        item.point.show = true;
        updated++;
      } catch {
        item.point.show = false;
      }
    }
    status(`SATÉLITES ACTIVOS: ${records.length.toLocaleString('es-AR')} · POSICIONES CALCULADAS: ${updated.toLocaleString('es-AR')} · SGP4/OMM`);
  }

  function parseRecords(input: OmmRecord[]) {
    collection.removeAll();
    records.length = 0;
    for (const omm of input.slice(0, MAX_RECORDS)) {
      try {
        if (!omm || !omm.OBJECT_NAME || !omm.NORAD_CAT_ID || !omm.EPOCH) continue;
        const satrec = json2satrec(omm as any);
        if (satrec.error) continue;
        const name = String(omm.OBJECT_NAME).trim();
        const norad = String(omm.NORAD_CAT_ID);
        const point = collection.add({
          position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
          pixelSize: name.toUpperCase().includes('ISS') ? 10 : 5,
          color: satelliteColor(name),
          outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
          outlineWidth: 1,
          show: false,
          id: { source: 'CelesTrak', name, norad, epoch: String(omm.EPOCH) }
        });
        records.push({ name, norad, satrec, point });
      } catch {
        // Invalid orbital records are skipped without discarding the catalog.
      }
    }
    updatePositions();
  }

  async function load() {
    if (loading || records.length) return;
    loading = true;
    status('CARGANDO CATÁLOGO ORBITAL MUNDIAL…');
    const cached = await readCache();
    const cacheFresh = cached && Date.now() - cached.savedAt < CACHE_TTL;
    if (cached?.records?.length && cacheFresh) {
      parseRecords(cached.records);
      status(`CATÁLOGO EN CACHÉ: ${records.length.toLocaleString('es-AR')} satélites · datos dentro de ventana de 2 h`);
      loading = false;
      return;
    }

    try {
      // OMM JSON supports modern 6+ digit catalog numbers; legacy TLE does not.
      const apiRoot = String(apiBase || '').replace(/\/+$/, '');
      const catalogUrl = apiRoot ? `${apiRoot}/api/satellites/active` : 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=JSON';
      const response = await fetch(catalogUrl, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(45000)
      });
      if (!response.ok) throw new Error(`CelesTrak HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload) || !payload.length) throw new Error('El catálogo orbital llegó vacío o con formato inesperado.');
      await writeCache(payload);
      parseRecords(payload);
      status(`CATÁLOGO ACTUALIZADO: ${records.length.toLocaleString('es-AR')} satélites activos · CelesTrak`);
      lastError = '';
    } catch (error: any) {
      lastError = error?.message || 'No se pudo consultar CelesTrak';
      if (cached?.records?.length) {
        parseRecords(cached.records);
        status(`MODO CACHÉ: ${records.length.toLocaleString('es-AR')} satélites · actualización pendiente (${lastError})`);
      } else {
        status(`SIN DATOS ORBITALES: ${lastError}`);
      }
    } finally {
      loading = false;
    }
  }

  function onPick(movement: any) {
    if (!enabled) return;
    const picked = viewer.scene.pick(movement.position);
    const data = picked?.id;
    if (!data || data.source !== 'CelesTrak') return;
    if (selectedEntity) viewer.entities.remove(selectedEntity);
    const item = records.find((entry) => entry.norad === data.norad);
    const position = item?.point?.position;
    if (!position) return;
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
      description: `<strong>${String(data.name).replace(/[&<>"]/g, '')}</strong><br>Número NORAD: ${data.norad}<br>Fuente orbital: CelesTrak · OMM/SGP4<br>Época de elementos: ${data.epoch}<br><small>Posición calculada a partir de elementos orbitales públicos; no es una medición de radar.</small>`
    });
    viewer.selectedEntity = selectedEntity;
    status(`SELECCIONADO: ${data.name} · NORAD ${data.norad}`);
  }

  const clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  clickHandler.setInputAction(onPick, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  function setEnabled(value: boolean) {
    enabled = Boolean(value);
    collection.show = enabled;
    if (selectedEntity) selectedEntity.show = enabled;
    if (enabled) {
      void load();
      if (!timer) timer = setInterval(updatePositions, REFRESH_POSITIONS_MS);
      status(records.length
        ? `SATÉLITES: ${records.length.toLocaleString('es-AR')} · ACTUALIZANDO POSICIONES`
        : 'CONECTANDO CON CATÁLOGO ORBITAL MUNDIAL…');
    } else {
      if (timer) clearInterval(timer);
      timer = null;
      status('');
    }
  }

  return {
    setEnabled,
    refresh: load,
    getState: () => ({ enabled, count: records.length, loading, error: lastError })
  };
}
