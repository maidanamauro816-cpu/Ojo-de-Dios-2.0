declare const Cesium: any;

type Fix = {
  lat: number;
  lon: number;
  accuracy: number;
  altitude: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number;
};

/**
 * Ubicación en vivo del dispositivo (navigator.geolocation.watchPosition).
 * Muestra un punto con círculo de precisión, vuela hasta la posición al primer fix
 * y sigue actualizando mientras la capa esté activa. Nada se envía a ningún servidor.
 */
export function createLocationLayer({
  viewer,
  Cesium,
  statusElement
}: {
  viewer: any;
  Cesium: any;
  statusElement?: HTMLElement | null;
}) {
  let watchId: number | null = null;
  let fix: Fix | null = null;
  let centeredOnce = false;
  let marker: any = null;
  let accuracyCircle: any = null;
  let headingArrow: any = null;
  let onChange: (active: boolean) => void = () => {};

  function status(message: string) {
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.hidden = !message;
  }

  function ensureEntities() {
    if (marker) return;
    const position = new Cesium.CallbackProperty(
      () => (fix ? Cesium.Cartesian3.fromDegrees(fix.lon, fix.lat) : undefined),
      false
    );
    accuracyCircle = viewer.entities.add({
      id: 'my-location-accuracy',
      position,
      ellipse: {
        semiMajorAxis: new Cesium.CallbackProperty(() => Math.max(fix?.accuracy ?? 10, 5), false),
        semiMinorAxis: new Cesium.CallbackProperty(() => Math.max(fix?.accuracy ?? 10, 5), false),
        material: Cesium.Color.fromCssColorString('#4aa3ff').withAlpha(0.18),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#4aa3ff').withAlpha(0.7),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      }
    });
    marker = viewer.entities.add({
      id: 'my-location',
      name: 'Mi ubicación',
      position,
      point: {
        pixelSize: 15,
        color: Cesium.Color.fromCssColorString('#2f80ff'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 3,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: 'Mi ubicación',
        font: 'bold 12px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -24),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    // Línea corta en la dirección de marcha, solo cuando el dispositivo informa rumbo.
    headingArrow = viewer.entities.add({
      id: 'my-location-heading',
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          if (!fix || fix.heading === null || !Number.isFinite(fix.heading) || (fix.speed ?? 0) < 0.8) return [];
          const meters = 40;
          const rad = (fix.heading * Math.PI) / 180;
          const dLat = (meters * Math.cos(rad)) / 111320;
          const dLon = (meters * Math.sin(rad)) / (111320 * Math.max(Math.cos((fix.lat * Math.PI) / 180), 0.01));
          return Cesium.Cartesian3.fromDegreesArray([fix.lon, fix.lat, fix.lon + dLon, fix.lat + dLat]);
        }, false),
        width: 5,
        material: new Cesium.PolylineArrowMaterialProperty(Cesium.Color.fromCssColorString('#2f80ff')),
        clampToGround: true
      }
    });
  }

  function formatStatus() {
    if (!fix) return 'BUSCANDO SEÑAL GPS…';
    const parts = [
      `MI UBICACIÓN: ${fix.lat.toFixed(5)}°, ${fix.lon.toFixed(5)}°`,
      `±${Math.round(fix.accuracy)} m`
    ];
    if (fix.speed !== null && Number.isFinite(fix.speed) && fix.speed >= 0.5) parts.push(`${Math.round(fix.speed * 3.6)} km/h`);
    if (fix.altitude !== null && Number.isFinite(fix.altitude)) parts.push(`${Math.round(fix.altitude)} m s. n. m.`);
    parts.push('tocá para centrar');
    return parts.join(' · ');
  }

  function recenter(duration = 2.2) {
    if (!fix) return;
    // La altura se ajusta a la precisión: con poca precisión no tiene sentido acercarse tanto.
    const height = Math.min(Math.max(fix.accuracy * 12, 1200), 20000);
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(fix.lon, fix.lat, height),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
      duration
    });
  }

  function onPosition(position: GeolocationPosition) {
    const c = position.coords;
    fix = {
      lat: c.latitude,
      lon: c.longitude,
      accuracy: c.accuracy,
      altitude: c.altitude,
      heading: c.heading,
      speed: c.speed,
      timestamp: position.timestamp
    };
    ensureEntities();
    viewer.scene.requestRender?.();
    status(formatStatus());
    if (!centeredOnce) {
      centeredOnce = true;
      recenter();
    }
  }

  function onError(error: GeolocationPositionError) {
    const messages: Record<number, string> = {
      1: 'PERMISO DE UBICACIÓN DENEGADO · habilitalo en los ajustes del dispositivo',
      2: 'UBICACIÓN NO DISPONIBLE · revisá que el GPS esté activo',
      3: 'TIEMPO AGOTADO ESPERANDO SEÑAL GPS · reintentando'
    };
    status(messages[error.code] || 'ERROR DE UBICACIÓN');
    // Si el permiso se deniega no tiene sentido seguir escuchando.
    if (error.code === 1) stop();
  }

  function start() {
    if (watchId !== null) return true;
    if (!('geolocation' in navigator)) {
      status('ESTE DISPOSITIVO O NAVEGADOR NO OFRECE GEOLOCALIZACIÓN');
      return false;
    }
    status('SOLICITANDO UBICACIÓN…');
    centeredOnce = false;
    watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 20000
    });
    onChange(true);
    return true;
  }

  function stop() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    fix = null;
    for (const entity of [marker, accuracyCircle, headingArrow]) if (entity) viewer.entities.remove(entity);
    marker = accuracyCircle = headingArrow = null;
    if (statusElement && !statusElement.textContent?.startsWith('PERMISO')) status('');
    onChange(false);
  }

  statusElement?.addEventListener('click', () => recenter(1.2));

  return {
    toggle() {
      if (watchId === null) return start();
      stop();
      return false;
    },
    start,
    stop,
    recenter,
    isActive: () => watchId !== null,
    getFix: () => fix,
    onChange(callback: (active: boolean) => void) {
      onChange = callback;
    }
  };
}
