import { createJsonCameraSource } from './sourceFactory.js';

// ASFINAG endpoint not supplied/verified yet. Kept disabled rather than
// guessing an undocumented endpoint.
export const AustriaAsfinagSource = createJsonCameraSource({
  id: 'at-asfinag',
  name: 'Austria - ASFINAG',
  region: 'AT',
  catalogUrl: null,
  allowedHosts: ['asfinag.at', 'www.asfinag.at'],
  license: 'ASFINAG open-data terms (verification pending)',
  parse: (raw) => ({
    id: `at-asfinag-${raw.id || raw.cameraId}`,
    lat: raw.lat ?? raw.latitude,
    lon: raw.lon ?? raw.longitude,
    heading: raw.heading ?? raw.direction,
    title: raw.name || raw.title || 'ASFINAG camera',
    pose: { imageUrl: raw.imageUrl || raw.image || raw.url }
  })
});
