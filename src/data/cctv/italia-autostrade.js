import { createJsonCameraSource } from './sourceFactory.js';

export const ItaliaAutostradeSource = createJsonCameraSource({
  id: 'it-autostrade',
  name: "Italia - Autostrade per l'Italia",
  region: 'IT',
  catalogUrl: 'https://www.autostrade.it/api/cctv/list',
  allowedHosts: ['autostrade.it', 'www.autostrade.it'],
  maxBytes: 3 * 1024 * 1024,
  license: 'Autostrade - condiciones de reutilización pendientes de verificar',
  extract: (data) => data.cameras || data.telecamere || data,
  parse: (raw) => {
    const coordinates = raw.coords || [raw.lon, raw.lat];
    return {
      id: `it-autostrade-${raw.id}`,
      lat: raw.lat ?? coordinates[1],
      lon: raw.lon ?? coordinates[0],
      heading: raw.direzione,
      title: `A${raw.autostrada || ''} Km ${raw.km || ''} - ${raw.localita || ''}`,
      pose: { imageUrl: raw.immagine || raw.imageUrl }
    };
  }
});
