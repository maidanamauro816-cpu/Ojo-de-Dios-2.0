import { createJsonCameraSource } from './sourceFactory.js';

const IMAGE_ORIGIN = 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/';

function propertiesOf(place) {
  return Object.fromEntries((place?.additionalProperties || []).filter((item) => item?.key).map((item) => [item.key, item.value]));
}

function validImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.origin === 'https://s3-eu-west-1.amazonaws.com' && url.pathname.startsWith('/jamcams.tfl.gov.uk/');
  } catch {
    return false;
  }
}

export const TfLLondonSource = createJsonCameraSource({
  id: 'uk-tfl-jamcams',
  name: 'Reino Unido - Transport for London',
  region: 'GB-LND',
  catalogUrl: 'https://api.tfl.gov.uk/Place/Type/JamCam',
  allowedHosts: ['api.tfl.gov.uk', 's3-eu-west-1.amazonaws.com'],
  maxBytes: 3 * 1024 * 1024,
  verified: true,
  license: 'Open Government Licence v3.0 · Powered by TfL Open Data',
  extract: (data) => Array.isArray(data) ? data.filter((place) => {
    const props = propertiesOf(place);
    return String(props.available).toLowerCase() === 'true' &&
      Number.isFinite(Number(place?.lat)) && Number.isFinite(Number(place?.lon)) &&
      validImageUrl(props.imageUrl) && /^JamCams_[A-Za-z0-9._-]{1,60}$/.test(String(place?.id || ''));
  }) : [],
  parse: (place) => {
    const props = propertiesOf(place);
    const rawId = String(place.id).replace(/^JamCams_/, '');
    return {
      id: `tfl-${rawId.toLowerCase()}`,
      lat: place.lat,
      lon: place.lon,
      heading: 0,
      title: String(place.commonName || `TfL JamCam ${rawId}`),
      pose: { imageUrl: props.imageUrl }
    };
  }
});
