const radians = (degrees) => degrees * Math.PI / 180;
const degrees = (radiansValue) => radiansValue * 180 / Math.PI;
const EARTH_RADIUS_M = 6371008.8;

function destinationPoint(lat, lon, bearing, distanceM) {
  const angular = distanceM / EARTH_RADIUS_M;
  const phi1 = radians(lat);
  const lambda1 = radians(lon);
  const theta = radians(bearing);
  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(angular) +
    Math.cos(phi1) * Math.sin(angular) * Math.cos(theta)
  );
  const lambda2 = lambda1 + Math.atan2(
    Math.sin(theta) * Math.sin(angular) * Math.cos(phi1),
    Math.cos(angular) - Math.sin(phi1) * Math.sin(phi2)
  );
  return { lat: degrees(phi2), lon: ((degrees(lambda2) + 540) % 360) - 180 };
}

function bearingBetween(a, b) {
  const phi1 = radians(a.lat);
  const phi2 = radians(b.lat);
  const delta = radians(b.lon - a.lon);
  const y = Math.sin(delta) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(delta);
  return (degrees(Math.atan2(y, x)) + 360) % 360;
}

function distanceMeters(a, b) {
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

const CAMERA_ICON = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path fill="#07111d" stroke="#f4c95d" stroke-width="4" d="M8 18h48v34H8z"/><path fill="#f4c95d" d="M18 12h15l5 6H18z"/><circle cx="32" cy="35" r="12" fill="#07111d" stroke="#f4c95d" stroke-width="4"/><circle cx="32" cy="35" r="5" fill="#f4c95d"/></svg>'
);

/**
 * Public-government road CCTV layer. Every pose is explicitly estimated;
 * calibration only changes a visual heading/coverage hypothesis.
 */
export function createCctvLayer({ viewer, Cesium, container, apiBase = '' }) {
  const apiRoot = String(apiBase || '').replace(/\/+$/, '');
  const apiPath = (path) => `${apiRoot}${path}`;
  const state = {
    enabled: false,
    showViewshed: false,
    cameras: [],
    sources: [],
    byId: new Map(),
    entities: new Map(),
    regionEnabled: new Map(),
    selectedId: null,
    handler: null,
    draggingId: null,
    refreshTimer: null
  };

  const controls = {
    regions: container?.querySelector('#cctv-regions'),
    status: container?.querySelector('#cctv-status'),
    details: container?.querySelector('#cctv-details'),
    nearest: container?.querySelector('#cctv-nearest'),
    viewshed: container?.querySelector('#cctv-viewshed'),
    reload: container?.querySelector('#cctv-reload')
  };

  function setStatus(message) {
    if (controls.status) controls.status.textContent = message;
  }

  function entityRole(entity) {
    try {
      return entity?.properties?.role?.getValue(Cesium.JulianDate.now()) || '';
    } catch {
      return '';
    }
  }

  function entityCameraId(entity) {
    try {
      return entity?.properties?.cameraId?.getValue(Cesium.JulianDate.now()) || '';
    } catch {
      return '';
    }
  }

  function setEntityMetadata(entity, role, cameraId) {
    entity.properties = new Cesium.PropertyBag({ role, cameraId });
    return entity;
  }

  function cameraPosition(camera, altitude = 8) {
    return Cesium.Cartesian3.fromDegrees(camera.lon, camera.lat, altitude);
  }

  function planeCorners(camera) {
    const range = Math.max(100, Math.min(5000, camera.rangeM || 900));
    const fov = Math.max(20, Math.min(120, camera.fovDeg || 65));
    const halfWidth = range * Math.tan(radians(fov / 2));
    const halfHeight = halfWidth * 9 / 16;
    const center = destinationPoint(camera.lat, camera.lon, camera.heading || 0, range);
    const left = destinationPoint(center.lat, center.lon, (camera.heading || 0) - 90, halfWidth);
    const right = destinationPoint(center.lat, center.lon, (camera.heading || 0) + 90, halfWidth);
    const baseAlt = 4;
    return {
      tl: Cesium.Cartesian3.fromDegrees(left.lon, left.lat, baseAlt + halfHeight),
      tr: Cesium.Cartesian3.fromDegrees(right.lon, right.lat, baseAlt + halfHeight),
      br: Cesium.Cartesian3.fromDegrees(right.lon, right.lat, baseAlt),
      bl: Cesium.Cartesian3.fromDegrees(left.lon, left.lat, baseAlt)
    };
  }

  function viewshedPositions(camera) {
    const range = Math.max(100, Math.min(5000, camera.rangeM || 900));
    const fov = Math.max(20, Math.min(120, camera.fovDeg || 65));
    const heading = camera.heading || 0;
    const positions = [Cesium.Cartesian3.fromDegrees(camera.lon, camera.lat, 1)];
    const steps = 28;
    for (let i = 0; i <= steps; i++) {
      const bearing = heading - fov / 2 + (fov * i / steps);
      const point = destinationPoint(camera.lat, camera.lon, bearing, range);
      positions.push(Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 1));
    }
    return positions;
  }

  function removeVisuals(id) {
    const record = state.entities.get(id);
    if (!record) return;
    for (const entity of Object.values(record)) {
      if (entity) viewer.entities.remove(entity);
    }
    state.entities.delete(id);
  }

  function makeCameraVisual(camera) {
    removeVisuals(camera.id);
    const visible = state.enabled && state.regionEnabled.get(camera.region) !== false;
    const marker = viewer.entities.add({
      name: camera.title,
      position: cameraPosition(camera),
      billboard: {
        image: CAMERA_ICON,
        width: 25,
        height: 25,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        scaleByDistance: new Cesium.NearFarScalar(500, 1.1, 3000000, 0.35),
        disableDepthTestDistance: 0
      },
      label: {
        text: camera.title,
        font: '11px sans-serif',
        fillColor: Cesium.Color.fromCssColorString('#f4d47a'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        scaleByDistance: new Cesium.NearFarScalar(300, 1, 1500000, 0.25),
        show: false
      },
      show: visible,
      description: `<strong>${escapeHtml(camera.title)}</strong><br>Fuente: ${escapeHtml(camera.sourceName)}<br>Región: ${escapeHtml(camera.region)}<br>Pose estimada; calibración manual disponible.`
    });
    setEntityMetadata(marker, 'camera', camera.id);

    const handlePoint = destinationPoint(camera.lat, camera.lon, camera.heading || 0, 160);
    const gizmo = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(handlePoint.lon, handlePoint.lat, 18),
      point: {
        pixelSize: 12,
        color: Cesium.Color.fromCssColorString('#4de5ff'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: 100000
      },
      show: visible && state.selectedId === camera.id
    });
    setEntityMetadata(gizmo, 'gizmo', camera.id);

    const guide = viewer.entities.add({
      polyline: {
        positions: [cameraPosition(camera, 12), Cesium.Cartesian3.fromDegrees(handlePoint.lon, handlePoint.lat, 18)],
        width: 2,
        material: Cesium.Color.fromCssColorString('#4de5ff').withAlpha(0.8),
        clampToGround: false
      },
      show: visible && state.selectedId === camera.id
    });

    const corners = planeCorners(camera);
    const rays = viewer.entities.add({
      polyline: {
        positions: [
          cameraPosition(camera, 8), corners.tl,
          cameraPosition(camera, 8), corners.tr,
          cameraPosition(camera, 8), corners.br,
          cameraPosition(camera, 8), corners.bl
        ],
        width: 1.5,
        material: Cesium.Color.fromCssColorString('#f2c85b').withAlpha(0.8)
      },
      show: visible && state.selectedId === camera.id
    });

    const plane = viewer.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy([corners.tl, corners.tr, corners.br, corners.bl]),
        perPositionHeight: true,
        material: new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString('#1d3548').withAlpha(0.55)),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#f2c85b')
      },
      show: false
    });

    const sector = viewer.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(viewshedPositions(camera)),
        perPositionHeight: true,
        material: Cesium.Color.fromCssColorString('#30d69a').withAlpha(0.16),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#30d69a').withAlpha(0.7),
        height: 1
      },
      show: visible && state.showViewshed
    });

    state.entities.set(camera.id, { marker, gizmo, guide, rays, plane, sector });
  }

  function refreshCameraGeometry(camera) {
    const oldSelected = state.selectedId;
    makeCameraVisual(camera);
    if (oldSelected === camera.id) showSelectedCamera(camera);
  }

  function updateRegionVisibility() {
    for (const camera of state.cameras) {
      const visible = state.enabled && state.regionEnabled.get(camera.region) !== false;
      const entities = state.entities.get(camera.id);
      if (!entities) continue;
      entities.marker.show = visible;
      entities.gizmo.show = visible && state.selectedId === camera.id;
      entities.guide.show = visible && state.selectedId === camera.id;
      entities.rays.show = visible && state.selectedId === camera.id;
      entities.sector.show = visible && state.showViewshed;
      entities.plane.show = visible && state.selectedId === camera.id && !!camera.frameUrl;
    }
  }

  function showSelectedCamera(camera) {
    state.selectedId = camera.id;
    for (const item of state.cameras) {
      const visual = state.entities.get(item.id);
      if (!visual) continue;
      visual.marker.label.show = item.id === camera.id;
      visual.gizmo.show = state.enabled && item.id === camera.id && state.regionEnabled.get(item.region) !== false;
      visual.guide.show = visual.gizmo.show;
      visual.rays.show = visual.gizmo.show;
      visual.plane.show = visual.gizmo.show && !!item.frameUrl;
      visual.sector.show = state.enabled && state.showViewshed && state.regionEnabled.get(item.region) !== false;
    }

    const visual = state.entities.get(camera.id);
    if (visual && camera.frameUrl) {
      const frameUrl = camera.frameUrl + (camera.frameUrl.includes('?') ? '&' : '?') + 'v=' + Date.now();
      visual.plane.polygon.material = new Cesium.ImageMaterialProperty({
        image: frameUrl,
        transparent: false
      });
    }

    if (controls.details) {
      controls.details.innerHTML = `
        <div class="cctv-detail-title">${escapeHtml(camera.title)}</div>
        <div>Fuente: ${escapeHtml(camera.sourceName)}</div>
        <div>Región: ${escapeHtml(camera.region)} · ID: ${escapeHtml(camera.id)}</div>
        <div>Orientación estimada: ${Math.round(camera.heading || 0)}° · Alcance estimado: ${camera.rangeM || 900} m</div>
        <div class="cctv-license">${escapeHtml(camera.license || 'Licencia pendiente de verificación')}</div>
        <small>Arrastrá el punto celeste para calibrar la orientación. La pose no representa una medición certificada.</small>
      `;
    }
  }

  function renderRegions() {
    if (!controls.regions) return;
    controls.regions.innerHTML = '';
    const regions = [...new Set(state.sources.map((source) => source.region || '—'))].sort();
    for (const region of regions) {
      const source = state.sources.find((item) => item.region === region);
      const row = document.createElement('label');
      row.className = 'cctv-region';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.regionEnabled.get(region) !== false;
      checkbox.addEventListener('change', () => {
        state.regionEnabled.set(region, checkbox.checked);
        updateRegionVisibility();
      });
      const name = document.createElement('span');
      name.textContent = `${region} · ${source?.name || 'Fuente'}`;
      const count = document.createElement('small');
      count.textContent = source?.status === 'ok' ? String(source.count) : (source?.status === 'stale' ? 'caché' : 'pendiente');
      row.append(checkbox, name, count);
      controls.regions.append(row);
    }
  }

  function selectCamera(camera, fly = true) {
    if (!camera) return;
    showSelectedCamera(camera);
    if (fly) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(camera.lon, camera.lat, 2200),
        duration: 1.3
      });
    }
    updateRegionVisibility();
  }

  function nearestCamera() {
    if (!state.cameras.length) return;
    const center = viewer.camera.positionCartographic;
    const origin = {
      lat: degrees(center.latitude),
      lon: degrees(center.longitude)
    };
    const camera = state.cameras
      .filter((item) => state.regionEnabled.get(item.region) !== false)
      .sort((a, b) => distanceMeters(origin, a) - distanceMeters(origin, b))[0];
    selectCamera(camera);
  }

  function pickGround(position) {
    const world = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
    if (!world) return null;
    const cartographic = Cesium.Cartographic.fromCartesian(world);
    return { lat: degrees(cartographic.latitude), lon: degrees(cartographic.longitude) };
  }

  function installCalibrationGizmo() {
    state.handler?.destroy();
    state.handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    state.handler.setInputAction((movement) => {
      const picked = viewer.scene.pick(movement.position);
      const entity = picked?.id;
      if (entityRole(entity) === 'gizmo') {
        state.draggingId = entityCameraId(entity);
        viewer.scene.screenSpaceCameraController.enableRotate = false;
      } else if (entityRole(entity) === 'camera') {
        const camera = state.byId.get(entityCameraId(entity));
        if (camera) selectCamera(camera, false);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

    state.handler.setInputAction((movement) => {
      if (!state.draggingId) return;
      const camera = state.byId.get(state.draggingId);
      const target = pickGround(movement.endPosition);
      if (!camera || !target) return;
      camera.heading = bearingBetween(camera, target);
      refreshCameraGeometry(camera);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    state.handler.setInputAction(() => {
      state.draggingId = null;
      viewer.scene.screenSpaceCameraController.enableRotate = true;
    }, Cesium.ScreenSpaceEventType.LEFT_UP);
  }

  async function load() {
    setStatus('Consultando catálogos públicos…');
    try {
      const response = await fetch(apiPath('/api/cctv/catalog'), { cache: 'no-store' });
      if (!response.ok) throw new Error('Proxy CCTV HTTP ' + response.status);
      const payload = await response.json();
      state.cameras = Array.isArray(payload.cameras) ? payload.cameras : [];
      state.sources = Array.isArray(payload.sources) ? payload.sources : [];
      state.byId = new Map(state.cameras.map((camera) => [camera.id, {
        ...camera, heading: Number(camera.heading) || 0, rangeM: 900, fovDeg: 65,
        poseEstimated: true
      }]));
      state.cameras = [...state.byId.values()];
      for (const camera of state.cameras) {
        if (!state.regionEnabled.has(camera.region)) state.regionEnabled.set(camera.region, true);
        makeCameraVisual(camera);
      }
      renderRegions();
      setStatus(`${state.cameras.length} cámaras · ${state.sources.filter((s) => s.status === 'ok').length} fuentes activas`);
      if (!state.cameras.length) {
        const pending = state.sources.filter((source) => source.status === 'disabled' || source.status === 'error');
        setStatus(`Sin cámaras verificadas. ${pending.length} fuentes pendientes o con error.`);
      }
      installCalibrationGizmo();
      updateRegionVisibility();
      return payload;
    } catch (error) {
      setStatus('No se pudo cargar CCTV: ' + (error?.message || error));
      return null;
    }
  }

  function setEnabled(enabled) {
    state.enabled = Boolean(enabled);
    if (state.enabled && !state.cameras.length) void load();
    updateRegionVisibility();
    if (container) container.hidden = !state.enabled;
  }

  function setViewshed(enabled) {
    state.showViewshed = Boolean(enabled);
    if (controls.viewshed) {
      controls.viewshed.classList.toggle('active', state.showViewshed);
      controls.viewshed.setAttribute('aria-pressed', String(state.showViewshed));
    }
    updateRegionVisibility();
  }

  controls.nearest?.addEventListener('click', nearestCamera);
  controls.viewshed?.addEventListener('click', () => setViewshed(!state.showViewshed));
  controls.reload?.addEventListener('click', () => { void load(); });

  return {
    load,
    setEnabled,
    setViewshed,
    nearestCamera,
    selectCamera,
    getState: () => ({ enabled: state.enabled, count: state.cameras.length, selectedId: state.selectedId })
  };
}
