import { createJsonCameraSource } from './sourceFactory.js';

export const JapanNexcoSource = createJsonCameraSource({
  id: 'jp-nexco',
  name: 'Japón - NEXCO Expressway',
  region: 'JP',
  catalogUrl: 'https://www.e-nexco.co.jp/api/cctv/list',
  allowedHosts: ['e-nexco.co.jp', 'www.e-nexco.co.jp'],
  maxBytes: 4 * 1024 * 1024,
  license: 'NEXCO - licencia de reutilización pendiente de verificación',
  extract: (data) => data.cctv || data.cameras || data,
  parse: (raw) => ({
    id: `jp-nexco-${raw.id || raw.camera_id}`,
    lat: raw.lat ?? raw.latitude,
    lon: raw.lon ?? raw.longitude,
    heading: raw.direction,
    title: `${raw.route || ''} ${raw.ic || raw.kp || ''} - ${raw.name || ''}`,
    pose: { imageUrl: raw.image_url || raw.snapshot }
  })
});
