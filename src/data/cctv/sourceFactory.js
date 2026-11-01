const finite = (value) => {
  if (value === null || value === undefined || value === '') return NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
};

export function createJsonCameraSource(config) {
  const source = {
    ...config,
    type: 'public_dot',
    enabled: Boolean(config.catalogUrl),
    async fetchCatalog({ fetchWithCap }) {
      if (!this.catalogUrl) return [];
      const response = await fetchWithCap(this.catalogUrl, {
        maxBytes: config.maxBytes || 2 * 1024 * 1024,
        redirect: 'error',
        allowedHosts: this.allowedHosts
      });
      if (!response.ok) throw new Error(`${this.id} HTTP ${response.status}`);
      const data = await response.json();
      const list = config.extract ? config.extract(data) : data;
      if (!Array.isArray(list)) throw new Error(`${this.id}: catálogo JSON inesperado`);
      return list;
    },
    parseCamera(raw) {
      const parsed = config.parse(raw);
      return {
        ...parsed,
        lat: finite(parsed.lat),
        lon: finite(parsed.lon),
        heading: finite(parsed.heading) || 0,
        pose: {
          isEstimated: true,
          imageUrl: typeof parsed.pose?.imageUrl === 'string' ? parsed.pose.imageUrl : null,
          videoUrl: null
        },
        meta: {
          source: this.id,
          isPublic: true,
          region: config.region,
          license: config.license || 'Condiciones de reutilización pendientes de verificar',
          licenseStatus: 'unverified'
        }
      };
    },
    isValid(point) {
      return Number.isFinite(point.lat) &&
        Number.isFinite(point.lon) &&
        point.lat >= -90 && point.lat <= 90 &&
        point.lon >= -180 && point.lon <= 180;
    }
  };
  return source;
}
