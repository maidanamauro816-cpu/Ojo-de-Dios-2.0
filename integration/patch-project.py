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

satellite_pattern = r"const res = await fetch\(.+?/api/satellite/.+?\);\s*if \(!res\.ok\) throw new Error\(.+?\);\s*const data = await res\.json\(\);\s*const lines = \(data\.tle \|\| ''\)\.trim\(\)\.split\(/\\\\r\?\\\\n/\);"
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
