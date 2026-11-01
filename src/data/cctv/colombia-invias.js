import { createJsonCameraSource } from './sourceFactory.js';

export const ColombiaInviasSource = createJsonCameraSource({
  id: 'co-invias',
  name: 'Colombia - INVIAS Vías',
  region: 'CO',
  catalogUrl: 'https://www.invias.gov.co/api/camaras',
  allowedHosts: ['invias.gov.co', 'www.invias.gov.co'],
  maxBytes: 2 * 1024 * 1024,
  license: 'INVIAS - condiciones de reutilización pendientes de verificar',
  extract: (data) => data.camaras || data,
  parse: (raw) => ({
    id: `co-invias-${raw.id}`,
    lat: raw.latitud ?? raw.lat,
    lon: raw.longitud ?? raw.lon,
    heading: raw.azimut,
    title: `Vía ${raw.via || ''} Km ${raw.km || ''} - ${raw.departamento || ''}`,
    pose: { imageUrl: raw.imagen || raw.url }
  })
});
