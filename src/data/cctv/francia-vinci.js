import { createJsonCameraSource } from './sourceFactory.js';

export const FranciaVinciSource = createJsonCameraSource({
  id: 'fr-vinci',
  name: 'Francia - VINCI / Bison Futé',
  region: 'FR',
  catalogUrl: 'https://www.vinci-autoroutes.com/api/cctv',
  allowedHosts: ['vinci-autoroutes.com', 'www.vinci-autoroutes.com'],
  maxBytes: 3 * 1024 * 1024,
  license: 'VINCI / Bison Futé - condiciones de reutilización pendientes de verificar',
  extract: (data) => data.cameras || data.cctv || data,
  parse: (raw) => {
    const coordinates = raw.geometry?.coordinates || [raw.lon, raw.lat];
    return {
      id: `fr-vinci-${raw.id}`,
      lat: raw.lat ?? coordinates[1],
      lon: raw.lon ?? coordinates[0],
      heading: raw.cap,
      title: `${raw.autoroute || 'A'} ${raw.pk || raw.km || ''} - ${raw.ville || ''}`,
      pose: { imageUrl: raw.image || raw.urlImage }
    };
  }
});
