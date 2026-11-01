import { createJsonCameraSource } from './sourceFactory.js';

export const ArgentinaCabaSource = createJsonCameraSource({
  id: 'ar-caba',
  name: 'Argentina - CABA Tránsito',
  region: 'AR',
  catalogUrl: 'https://cdn.buenosaires.gob.ar/datosabiertos/camaras-transito/camaras.json',
  allowedHosts: ['cdn.buenosaires.gob.ar'],
  maxBytes: 1024 * 1024,
  license: 'GCBA Datos Abiertos - verificar atribución y condiciones vigentes',
  extract: (data) => Array.isArray(data) ? data : (data.camaras || data.features || []),
  parse: (raw) => ({
    id: `ar-caba-${raw.id || raw.camara_id}`,
    lat: raw.lat ?? raw.latitud ?? raw.geometry?.coordinates?.[1],
    lon: raw.lon ?? raw.longitud ?? raw.lng ?? raw.geometry?.coordinates?.[0],
    heading: raw.orientacion,
    title: raw.nombre || raw.ubicacion || `CABA ${raw.id || ''}`,
    pose: { imageUrl: raw.url_snapshot || raw.imagen || raw.image }
  })
});
