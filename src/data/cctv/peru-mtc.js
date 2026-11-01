import { createJsonCameraSource } from './sourceFactory.js';

export const PeruMtcSource = createJsonCameraSource({
  id: 'pe-mtc',
  name: 'Perú - MTC Provías',
  region: 'PE',
  catalogUrl: 'https://www.pvn.gob.pe/api/camaras',
  allowedHosts: ['pvn.gob.pe', 'www.pvn.gob.pe'],
  maxBytes: 2 * 1024 * 1024,
  license: 'MTC Perú - condiciones de reutilización pendientes de verificar',
  extract: (data) => data.camaras || data,
  parse: (raw) => ({
    id: `pe-mtc-${raw.id}`,
    lat: raw.latitud ?? raw.lat,
    lon: raw.longitud ?? raw.lon,
    heading: 0,
    title: `${raw.carretera || ''} Km ${raw.km || ''} - ${raw.departamento || ''}`,
    pose: { imageUrl: raw.imagen }
  })
});
