import { createJsonCameraSource } from './sourceFactory.js';

export const MexicoCapufeSource = createJsonCameraSource({
  id: 'mx-capufe',
  name: 'México - CAPUFE Autopistas',
  region: 'MX',
  catalogUrl: 'https://www.capufe.gob.mx/api/camaras',
  allowedHosts: ['capufe.gob.mx', 'www.capufe.gob.mx'],
  maxBytes: 2 * 1024 * 1024,
  license: 'CAPUFE - condiciones de reutilización pendientes de verificar',
  extract: (data) => data.camaras || data.cameras || data,
  parse: (raw) => ({
    id: `mx-capufe-${raw.id || raw.idCamara}`,
    lat: raw.latitud ?? raw.lat,
    lon: raw.longitud ?? raw.lon ?? raw.lng,
    heading: raw.orientacion,
    title: `${raw.autopista || ''} Km ${raw.km || ''} - ${raw.plaza || ''}`,
    pose: { imageUrl: raw.urlImagen || raw.imagen }
  })
});
