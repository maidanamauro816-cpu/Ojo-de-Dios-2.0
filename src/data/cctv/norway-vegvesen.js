import { createJsonCameraSource } from './sourceFactory.js';

// Statens vegvesen (Noruega): catálogo GeoJSON oficial, keyless,
// con snapshots publicados por la propia autoridad vial. Licencia NLOD 2.0.
const CATALOG_URL = 'https://ogckart-sn1.atlas.vegvesen.no/ogc/features/v1/collections/datex_3_1:CctvSimple/items?f=application/geo%2Bjson&limit=5000';
const IMAGE_ORIGIN = 'https://kamera.atlas.vegvesen.no/api/images/';

export const NorwayVegvesenSource = createJsonCameraSource({
  id: 'no-vegvesen',
  name: 'Noruega - Statens vegvesen',
  region: 'NO',
  catalogUrl: CATALOG_URL,
  allowedHosts: ['ogckart-sn1.atlas.vegvesen.no', 'kamera.atlas.vegvesen.no'],
  maxBytes: 4 * 1024 * 1024,
  verified: true,
  license: 'NLOD 2.0 · Contains data under the Norwegian licence for Open Government data distributed by Statens vegvesen',
  extract: (data) => Array.isArray(data?.features) ? data.features : [],
  parse: (feature) => {
    const props = feature?.properties || {};
    const coordinates = feature?.geometry?.coordinates || [];
    const cameraId = String(props.cameraId || '').trim();
    const availability = String(props['status.stillImageAvailability'] || '');
    const imageUrl = String(props.stillImageUrl || '');
    const validId = /^[A-Za-z0-9_-]{1,40}$/.test(cameraId);
    const expectedImage = IMAGE_ORIGIN + cameraId;
    return {
      id: 'no-vegvesen-' + cameraId.toLowerCase(),
      lat: coordinates[1],
      lon: coordinates[0],
      heading: 0,
      title: [props.roadNumber, props.description, props.orientationDescription].filter(Boolean).join(' · ') || 'Cámara vial de Noruega',
      pose: {
        imageUrl: validId && imageUrl === expectedImage && (!availability || availability === 'videoOrImagesAvailable')
          ? imageUrl
          : null
      }
    };
  }
});
