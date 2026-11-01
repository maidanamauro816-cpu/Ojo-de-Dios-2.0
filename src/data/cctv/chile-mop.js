import { createJsonCameraSource } from './sourceFactory.js';

export const ChileMopSource = createJsonCameraSource({
  id: 'cl-mop',
  name: 'Chile - MOP Rutas',
  region: 'CL',
  catalogUrl: 'https://www.mop.cl/api/camaras-transito',
  allowedHosts: ['mop.cl', 'www.mop.cl'],
  maxBytes: 2 * 1024 * 1024,
  license: 'MOP Chile - condiciones de reutilización pendientes de verificar',
  extract: (data) => data.camaras || data,
  parse: (raw) => ({
    id: `cl-mop-${raw.id}`,
    lat: raw.latitud ?? raw.lat,
    lon: raw.longitud ?? raw.lon,
    heading: raw.azimut,
    title: `Ruta ${raw.ruta || ''} Km ${raw.km || ''} - ${raw.comuna || ''}`,
    pose: { imageUrl: raw.imagen || raw.url }
  })
});
