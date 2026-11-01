import { createJsonCameraSource } from './sourceFactory.js';

const IMAGE_ORIGIN = 'https://weathercam.digitraffic.fi/';

function expandPresets(data) {
  const features = Array.isArray(data?.features) ? data.features : [];
  const cameras = [];
  for (const feature of features) {
    const props = feature?.properties || {};
    const stationId = String(props.id || '').trim();
    if (!stationId || String(props.collectionStatus || '').toUpperCase() !== 'GATHERING') continue;
    const coordinates = feature?.geometry?.coordinates || [];
    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 59 || lat > 71 || lon < 19 || lon > 32) continue;
    for (const preset of props.presets || []) {
      const presetId = String(preset?.id || '').trim();
      if (preset?.inCollection !== true || !/^C\d{7}$/.test(presetId) || !presetId.startsWith(stationId)) continue;
      cameras.push({
        presetId,
        stationName: String(props.name || stationId),
        lat,
        lon,
        imageUrl: `${IMAGE_ORIGIN}${presetId}.jpg`
      });
    }
  }
  return cameras;
}

export const FinlandDigitrafficSource = createJsonCameraSource({
  id: 'fi-digitraffic-weathercams',
  name: 'Finlandia - Fintraffic / Digitraffic',
  region: 'FI',
  catalogUrl: 'https://tie.digitraffic.fi/api/weathercam/v1/stations',
  allowedHosts: ['tie.digitraffic.fi', 'weathercam.digitraffic.fi'],
  maxBytes: 4 * 1024 * 1024,
  headers: { 'Digitraffic-User': 'Ojo de Dios 2.0' },
  verified: true,
  license: 'CC BY 4.0 · Fintraffic / digitraffic.fi',
  extract: expandPresets,
  parse: (camera) => ({
    id: `fi-${camera.presetId.toLowerCase()}`,
    lat: camera.lat,
    lon: camera.lon,
    heading: 0,
    title: `${camera.stationName} · ${camera.presetId}`,
    pose: { imageUrl: camera.imageUrl }
  })
});
