import { createJsonCameraSource } from './sourceFactory.js';

// DelDOT is retained as the original regional source. Its exact public catalog
// endpoint was not supplied, so it remains safely disabled until verified.
export const DelawareSource = createJsonCameraSource({
  id: 'us-delaware-deldot',
  name: 'Delaware - DelDOT',
  region: 'US-DE',
  catalogUrl: null,
  allowedHosts: ['deldot.gov', 'www.deldot.gov'],
  license: 'DelDOT public-data terms (verification pending)',
  parse: (raw) => ({
    id: `de-deldot-${raw.id || raw.camera_id || raw.name || 'unknown'}`,
    lat: raw.lat ?? raw.latitude,
    lon: raw.lon ?? raw.longitude ?? raw.lng,
    heading: raw.heading ?? raw.direction,
    title: raw.name || raw.title || 'DelDOT traffic camera',
    pose: { imageUrl: raw.image_url || raw.image || raw.url }
  })
});
