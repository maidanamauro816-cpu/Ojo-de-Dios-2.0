#!/usr/bin/env python3
"""Apply additive, repeatable integration patches to the extracted Ojo de Dios app."""
from pathlib import Path
import re
import shutil
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "project")
main_path = root / "src" / "main.ts"
camera_path = root / "src" / "cameras.ts"
overlay = Path("integration") / "src" / "world-layers.ts"

if not main_path.is_file() or not camera_path.is_file() or not overlay.is_file():
    raise SystemExit("Missing expected project source or integration overlay")

main = main_path.read_text(encoding="utf-8")
original = main

def replace_once(old: str, new: str, label: str) -> None:
    global main
    if old not in main:
        raise SystemExit("Patch anchor not found: " + label)
    main = main.replace(old, new, 1)

replace_once(
    "import { initCameraLayer } from './cameras';",
    "import { initCameraLayer } from './cameras';\nimport { initWorldLayers } from './world-layers';",
    "world layer import"
)

replace_once(
    "url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',\n    credit: '© OpenStreetMap contributors',",
    "url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',\n    credit: 'Powered by Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',",
    "satellite imagery basemap"
)

satellite_pattern = r"const res = await fetch\(.+?/api/satellite/.+?\);\s*if \(!res\.ok\) throw new Error\(.+?\);\s*const data = await res\.json\(\);\s*const lines = .*?;"
satellite_replacement = """const catalogNumber = satId === 'iss' ? '25544' : satId === 'tiangong' ? '48274' : '20580';
    const res = await fetch('https://celestrak.org/NORAD/elements/gp.php?CATNR=' + catalogNumber + '&FORMAT=TLE', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const tleText = await res.text();
    const lines = tleText.trim().split(/\\\\r?\\\\n/);"""
main, count = re.subn(satellite_pattern, satellite_replacement, main, count=1)
if count != 1:
    raise SystemExit("Patch anchor not found: CelesTrak public TLE endpoint")

main, count = re.subn(
    r"const url = .+?;",
    "const url = 'https://api.adsb.lol/v2/lat/' + center.lat.toFixed(4) + '/lon/' + center.lon.toFixed(4) + '/dist/' + radius;",
    main,
    count=1
)
if count != 1:
    raise SystemExit("Patch anchor not found: public ADS-B endpoint")

flight_pattern = r"if \(Array\.isArray\(data\.ac\)\) \{.*?\n    \}"
flight_replacement = """const aircraft = Array.isArray(data.ac) ? data.ac : (Array.isArray(data.aircraft) ? data.aircraft : []);
    if (aircraft.length) {
      aircraft.forEach(upsertAircraft);
      flightStatus.textContent = aircraft.length + ' aeronaves detectadas · ADS-B público';
    } else {
      flightStatus.textContent = 'Sin aeronaves reportadas en esta zona';
    }"""
main, count = re.subn(flight_pattern, flight_replacement, main, count=1, flags=re.S)
if count != 1:
    raise SystemExit("Patch anchor not found: ADS-B response compatibility")

replacement = """async function enrichAircraft(id: string, item: AircraftItem) {
  // The mobile build has no private server proxy. Use only fields actually
  // supplied by the public ADS-B feed; never fabricate owner, route or model data.
  const metadata = {
    registration: item.data.r || undefined,
    type: item.data.t || undefined
  };
  metadataCache.set(id, { metadata, route: null });
  renderAircraftDetail(item, metadata, null, false);
}

"""
main, count = re.subn(
    r"async function enrichAircraft\(id: string, item: AircraftItem\) \{.*?\n\}\n\n(?=function selectFlight)",
    replacement,
    main,
    count=1,
    flags=re.S
)
if count != 1:
    raise SystemExit("Patch anchor not found: remove unavailable aircraft metadata proxy")

replace_once(
    "// UI Event Listeners\ndocument.querySelectorAll('[data-layer]')",
    "// Additive public-data layers (kept separate from the original controls).\ninitWorldLayers(viewer, Cesium);\n\n// UI Event Listeners\ndocument.querySelectorAll('[data-layer]')",
    "world layer initialization"
)

if main == original:
    raise SystemExit("No changes were applied")
main_path.write_text(main, encoding="utf-8")
shutil.copy2(overlay, root / "src" / "world-layers.ts")

print("Applied additive world-layer integration:")
print("- Esri World Imagery basemap with attribution")
print("- CelesTrak public TLE retrieval for existing satellite trackers")
print("- adsb.lol public ADS-B regional snapshot")
print("- Public OpenStreetMap aerodrome / mapped-installation layer")
print("- Global USGS earthquake feed")
print("- Optional AISStream WebSocket connector (user-supplied key, session-only)")
print("- Removed unavailable private aircraft-enrichment proxy; displays only source-provided fields")


# Android-first globe UI, exclusive layer selection, and centered voice shortcut.
main = main_path.read_text(encoding="utf-8")
main = main.replace("minimumZoomDistance: 800,", "minimumZoomDistance: 2,")
main = main.replace("  iss: true,\n  satellites: false,\n  haarp: true,\n  strategic: true,", "  iss: false,\n  satellites: false,\n  haarp: false,\n  strategic: false,")
main = main.replace("});\n\n// Strategic Global Bases", "});\nhaarp.show = false;\n\n// Strategic Global Bases", 1)
main = main.replace("  strategicEntities.push(ent);\n});", "  ent.show = false;\n  strategicEntities.push(ent);\n});", 1)
main = main.replace("initWorldLayers(viewer, Cesium);", "const worldLayers = initWorldLayers(viewer, Cesium);")
start = main.find("// UI Event Listeners\ndocument.querySelectorAll('[data-layer]')")
end = main.find("// Search and radius controls", start)
if start < 0 or end < 0:
    raise SystemExit("Patch anchor not found: exclusive Android layer dock")
handler = r'''// Android-first layer dock: one active layer at a time, without moving the globe.
const layerDock = $('layer-dock');
const layerToolsPanel = $('layer-tools-panel');
const layerContainer = document.querySelector('.layers-container');
if (layerDock && layerContainer) layerDock.appendChild(layerContainer);
if (layerToolsPanel) {
  ['camera-tools', 'flight-tools', 'marine-tools'].forEach((id) => {
    const element = $(id);
    if (element) layerToolsPanel.appendChild(element);
  });
}
const mainPanel = $('main-panel');
if (mainPanel) mainPanel.hidden = true;

function syncLayerButtons(active: string | null) {
  document.querySelectorAll<HTMLElement>('[data-layer]').forEach((button) => {
    const selected = button.dataset.layer === active;
    button.classList.toggle('active', selected);
    const state = button.querySelector('.layer-state');
    if (state) state.textContent = selected ? 'ON' : 'OFF';
  });
  Object.keys(layerStates).forEach((key) => layerStates[key] = key === active);
  updateActiveLayerBadge();
}

function activateLayer(layer: string | null) {
  const next = layerStates[layer || ''] ? null : layer;
  Object.values(satTrackers).forEach((tracker: any) => { if (tracker.entity) tracker.entity.show = false; });
  haarp.show = false;
  strategicEntities.forEach((entity) => entity.show = false);
  if (flightsEnabled) setFlightsEnabled(false);
  cameraLayer.setEnabled(false);
  if (marineTools) marineTools.hidden = true;
  worldLayers?.setInstallationsEnabled(false);
  worldLayers?.setEarthquakesEnabled(false);
  if (layerToolsPanel) layerToolsPanel.hidden = !next || !['cameras','flights','ships'].includes(next);

  if (next === 'iss') {
    if (!satTrackers.iss.tle) loadSatelliteTle('iss');
    if (satTrackers.iss.entity) satTrackers.iss.entity.show = true;
  } else if (next === 'satellites') {
    if (!satTrackers.tiangong.tle) { loadSatelliteTle('tiangong'); loadSatelliteTle('hubble'); }
    updateSatellites();
  } else if (next === 'haarp') {
    haarp.show = true;
  } else if (next === 'strategic') {
    strategicEntities.forEach((entity) => entity.show = true);
  } else if (next === 'flights') {
    setFlightsEnabled(true);
  } else if (next === 'cameras') {
    cameraLayer.setEnabled(true);
  } else if (next === 'ships') {
    if (marineTools) marineTools.hidden = false;
  } else if (next === 'public-installations') {
    worldLayers?.setInstallationsEnabled(true);
  } else if (next === 'earthquakes') {
    worldLayers?.setEarthquakesEnabled(true);
  }
  syncLayerButtons(next);
}

document.querySelectorAll<HTMLElement>('[data-layer]').forEach((button) => {
  button.addEventListener('click', () => {
    const layer = button.dataset.layer;
    if (layer) activateLayer(layer);
  });
});

// Voice shortcuts use Android Web Speech when supported by the installed WebView.
const voiceButton = $('voice-command');
const voiceStatus = $('voice-status');
const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
if (voiceButton) {
  voiceButton.addEventListener('click', () => {
    if (!SpeechRecognitionCtor) {
      if (voiceStatus) voiceStatus.textContent = 'Reconocimiento de voz no disponible en este Android';
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'es-AR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    if (voiceStatus) voiceStatus.textContent = 'Escuchando…';
    recognition.onresult = (event: any) => {
      const command = String(event.results?.[0]?.[0]?.transcript || '').toLowerCase();
      const commands: Record<string, string> = {
        'cámaras': 'cameras', 'camara': 'cameras', 'cámaras públicas': 'cameras',
        'vuelos': 'flights', 'aviones': 'flights', 'buques': 'ships', 'barcos': 'ships',
        'satélites': 'satellites', 'iss': 'iss', 'estación espacial': 'iss',
        'bases': 'public-installations', 'instalaciones': 'public-installations',
        'terremotos': 'earthquakes', 'sismos': 'earthquakes', 'haarp': 'haarp'
      };
      const key = Object.keys(commands).find((item) => command.includes(item));
      if (key) { activateLayer(commands[key]); if (voiceStatus) voiceStatus.textContent = 'Capa activada: ' + key; }
      else if (voiceStatus) voiceStatus.textContent = 'No reconocí una capa: ' + command;
    };
    recognition.onerror = () => { if (voiceStatus) voiceStatus.textContent = 'No se pudo acceder al micrófono'; };
    recognition.onend = () => { if (voiceStatus && voiceStatus.textContent === 'Escuchando…') voiceStatus.textContent = 'Comando de voz listo'; };
    recognition.start();
  });
}

'''
main = main[:start] + handler + main[end:]
main_path.write_text(main, encoding="utf-8")

html_path = root / "index.html"
html = html_path.read_text(encoding="utf-8")
if 'id="layer-dock"' not in html:
    html = html.replace('    <!-- Sidebar Control Intelligence Panel -->', '''    <nav id="layer-dock" aria-label="Capas del globo"></nav>
    <button id="voice-command" type="button" aria-label="Comando de voz" title="Comando de voz">◉</button>
    <div id="voice-status" role="status">Comando de voz listo</div>
    <aside id="layer-tools-panel" hidden aria-label="Herramientas de la capa"></aside>

    <!-- Sidebar Control Intelligence Panel -->''', 1)
html_path.write_text(html, encoding="utf-8")

world_path = root / "src" / "world-layers.ts"
world = world_path.read_text(encoding="utf-8")
world = world.replace("button.dataset.worldLayer = id;", "button.dataset.layer = id;")
world = world.replace("""    let enabled = false;
    button.addEventListener('click', () => {
      enabled = !enabled;
      button.classList.toggle('active', enabled);
      state.textContent = enabled ? 'ON' : 'OFF';
      toggle(enabled);
    });
""", """    // Layer activation is centralized in main.ts to guarantee exclusivity.
""")
world = world.replace("  return { refreshInstallations, refreshEarthquakes };", """  function setInstallationsEnabled(on: boolean) {
    installationsOn = on;
    for (const entity of installationEntities.values()) entity.show = on;
    if (on) void refreshInstallations(true);
  }
  function setEarthquakesEnabled(on: boolean) {
    earthquakesOn = on;
    for (const entity of earthquakeEntities.values()) entity.show = on;
    if (on) void refreshEarthquakes();
  }
  return { refreshInstallations, refreshEarthquakes, setInstallationsEnabled, setEarthquakesEnabled };""")
world_path.write_text(world, encoding="utf-8")

style_path = root / "src" / "style.css"
style = style_path.read_text(encoding="utf-8")
style += r"""

/* Ojo de Dios 2.0 — Android globe-first interface */
#main-panel[hidden] { display:none !important; }
#layer-dock { position:fixed; z-index:30; left:8px; right:8px; bottom:calc(12px + env(safe-area-inset-bottom)); display:flex; align-items:center; overflow-x:auto; gap:7px; padding:9px; border:1px solid rgba(255,45,65,.55); border-radius:18px; background:rgba(5,6,10,.94); box-shadow:0 0 22px rgba(255,25,55,.22); scrollbar-width:none; }
#layer-dock::-webkit-scrollbar { display:none; }
#layer-dock .layers-container { display:flex; flex-wrap:nowrap; gap:7px; min-width:max-content; }
#layer-dock .layer { min-width:78px; width:78px; min-height:62px; display:flex; flex-direction:column; justify-content:center; align-items:center; gap:4px; padding:6px 4px; border:1px solid rgba(255,255,255,.12); border-radius:12px; background:#101116; color:#eee; }
#layer-dock .layer-icon { font-size:19px; }
#layer-dock .layer-info { display:block; text-align:center; }
#layer-dock .layer-info strong { display:block; font-size:9px; line-height:1.2; }
#layer-dock .layer-info small { display:none; }
#layer-dock .layer-state { font-size:8px; color:#888; }
#layer-dock .layer.active { border-color:#ff334f; color:#fff; box-shadow:inset 0 0 14px rgba(255,25,55,.22),0 0 12px rgba(255,25,55,.35); }
#layer-dock .layer.active .layer-state { color:#ff5369; }
#voice-command { position:fixed; z-index:32; left:50%; bottom:calc(104px + env(safe-area-inset-bottom)); transform:translateX(-50%); width:58px; height:58px; border-radius:50%; border:2px solid #d7ad55; color:#ffd778; background:radial-gradient(circle,#321018 0%,#09090d 72%); font-size:30px; box-shadow:0 0 12px rgba(255,40,65,.8),0 0 24px rgba(215,173,85,.28); }
#voice-status { position:fixed; z-index:31; left:50%; bottom:calc(165px + env(safe-area-inset-bottom)); transform:translateX(-50%); color:#f3d58d; font-size:10px; text-shadow:0 1px 5px #000; white-space:nowrap; pointer-events:none; }
#layer-tools-panel:not([hidden]) { position:fixed; z-index:29; left:10px; right:10px; bottom:calc(184px + env(safe-area-inset-bottom)); max-height:38dvh; overflow:auto; padding:10px; border:1px solid rgba(255,50,75,.5); border-radius:14px; background:rgba(5,7,12,.94); }
#layer-tools-panel > * { max-height:34dvh; overflow:auto; }
.topbar { background:linear-gradient(180deg,rgba(4,5,9,.95),rgba(4,5,9,.5),transparent); border-color:rgba(215,173,85,.25); }
.brand-icon,.accent { color:#d7ad55 !important; }
@media(max-width:640px) { .panel { display:none !important; } .topbar { height:52px; } .header-actions { gap:4px; } .header-actions .tactical-btn { padding:5px 7px; font-size:10px; } .cesium-viewer-toolbar { top:58px !important; right:8px !important; } footer { bottom:0; height:20px; padding:0 8px; font-size:8px; } .cesium-viewer-bottom { bottom:20px !important; } }
"""
style_path.write_text(style, encoding="utf-8")
