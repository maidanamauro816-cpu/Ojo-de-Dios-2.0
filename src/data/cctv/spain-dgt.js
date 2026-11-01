import { createJsonCameraSource } from './sourceFactory.js';

export const SpainDgtSource = createJsonCameraSource({
  id: 'es-dgt',
  name: 'España - DGT Autopistas',
  region: 'ES',
  catalogUrl: 'https://infocar.dgt.es/etraffic/BuscarElementos?tipo=Camaras',
  allowedHosts: ['infocar.dgt.es'],
  maxBytes: 3 * 1024 * 1024,
  license: 'DGT - condiciones de reutilización pendientes de verificar',
  extract: (data) => data.camaras || data.features || data,
  parse: (raw) => {
    const coordinates = raw.geometry?.coordinates || [raw.longitud, raw.latitud];
    return {
      id: `es-dgt-${raw.id || raw.codigo}`,
      lat: raw.latitud ?? coordinates[1],
      lon: raw.longitud ?? coordinates[0],
      heading: raw.orientacion,
      title: `${raw.carretera || 'DGT'} Km ${raw.kilometro || raw.pk || ''} - ${raw.provincia || ''}`,
      pose: { imageUrl: raw.urlImagen || raw.imagen || raw.image }
    };
  }
});
