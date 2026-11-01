/**
 * Global satellite weather imagery from NASA GIBS.
 * Clouds: VIIRS daily true-colour imagery (cloud systems visible in the scene).
 * Rain: GPM IMERG precipitation-rate visualization.
 * These are observation products, not forecasts. GIBS imagery can lag acquisition.
 */
export class GlobalWeatherLayer {
  constructor(viewer, onStatus = () => {}) {
    this.viewer = viewer;
    this.onStatus = onStatus;
    this.clouds = null;
    this.precipitation = null;
    this.date = this.defaultDate();
  }

  defaultDate() {
    const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  }

  setDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    this.date = date;
    if (this.clouds) this.replace('clouds');
    if (this.precipitation) this.replace('precipitation');
  }

  provider(layerName) {
    return new Cesium.WebMapServiceImageryProvider({
      url: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi',
      layers: layerName,
      parameters: {
        service: 'WMS',
        version: '1.1.1',
        request: 'GetMap',
        styles: '',
        format: 'image/png',
        transparent: true,
        time: this.date
      },
      tilingScheme: new Cesium.GeographicTilingScheme(),
      minimumLevel: 0,
      maximumLevel: 8,
      credit: 'NASA GIBS · NASA/NOAA satellite observations'
    });
  }

  replace(kind) {
    const oldLayer = kind === 'clouds' ? this.clouds : this.precipitation;
    const name = kind === 'clouds'
      ? 'VIIRS_SNPP_CorrectedReflectance_TrueColor'
      : 'IMERG_Rain_Rate';
    const next = this.viewer.imageryLayers.addImageryProvider(this.provider(name));
    next.alpha = kind === 'clouds' ? 0.68 : 0.78;
    next.show = true;
    if (oldLayer) this.viewer.imageryLayers.remove(oldLayer, true);
    if (kind === 'clouds') this.clouds = next;
    else this.precipitation = next;
    this.onStatus({
      clouds: Boolean(this.clouds),
      precipitation: Boolean(this.precipitation),
      date: this.date,
      message: 'NASA GIBS · ' + this.date
    });
  }

  setVisible(kind, visible) {
    const current = kind === 'clouds' ? this.clouds : this.precipitation;
    if (visible && !current) this.replace(kind);
    else if (!visible && current) {
      this.viewer.imageryLayers.remove(current, true);
      if (kind === 'clouds') this.clouds = null;
      else this.precipitation = null;
    }
    this.onStatus({
      clouds: Boolean(this.clouds),
      precipitation: Boolean(this.precipitation),
      date: this.date,
      message: 'NASA GIBS · ' + this.date
    });
  }

  destroy() {
    if (this.clouds) this.viewer.imageryLayers.remove(this.clouds, true);
    if (this.precipitation) this.viewer.imageryLayers.remove(this.precipitation, true);
    this.clouds = null;
    this.precipitation = null;
  }
}
