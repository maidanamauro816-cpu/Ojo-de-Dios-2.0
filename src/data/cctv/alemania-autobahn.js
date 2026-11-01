import { createJsonCameraSource } from './sourceFactory.js';

export const AlemaniaAutobahnSource = createJsonCameraSource({
  id: 'de-autobahn',
  name: 'Alemania - Autobahn GmbH',
  region: 'DE',
  catalogUrl: 'https://verkehr.autobahn.de/o/autobahn/cctv',
  allowedHosts: ['verkehr.autobahn.de'],
  maxBytes: 4 * 1024 * 1024,
  license: 'Autobahn GmbH - condiciones de reutilización pendientes de verificar',
  extract: (data) => data.cctv || data.webcams || data,
  parse: (raw) => ({
    id: `de-autobahn-${raw.id || raw.webcamId}`,
    lat: raw.lat ?? raw.coordinate?.lat,
    lon: raw.long ?? raw.coordinate?.long,
    heading: raw.heading,
    title: `${raw.route || raw.autobahn || ''} ${raw.title || ''}`,
    pose: { imageUrl: raw.imageUrl || raw.url }
  })
});
