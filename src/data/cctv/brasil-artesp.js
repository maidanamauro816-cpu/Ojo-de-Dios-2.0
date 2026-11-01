import { createJsonCameraSource } from './sourceFactory.js';

export const BrasilArtespSource = createJsonCameraSource({
  id: 'br-artesp',
  name: 'Brasil - SP Rodovias ARTESP',
  region: 'BR',
  catalogUrl: 'https://www.artesp.sp.gov.br/api/cameras',
  allowedHosts: ['artesp.sp.gov.br', 'www.artesp.sp.gov.br'],
  maxBytes: 2 * 1024 * 1024,
  license: 'ARTESP - licença/termos de dados abertos pendentes de verificação',
  extract: (data) => data.cameras || data,
  parse: (raw) => ({
    id: `br-artesp-${raw.id}`,
    lat: raw.latitude ?? raw.lat,
    lon: raw.longitude ?? raw.lng ?? raw.lon,
    heading: raw.azimuth,
    title: `SP-${raw.rodovia || ''} Km ${raw.km || ''} - ${raw.municipio || ''}`,
    pose: { imageUrl: raw.imagem || raw.url }
  })
});
