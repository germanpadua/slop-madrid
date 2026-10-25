# tools/madrid/bbox.py — regenerate the WGS84 corners in config.mjs from the UTM boxes.
# Usage: /path/to/python-with-pyproj tools/madrid/bbox.py  (prints a JS snippet)
from pyproj import Transformer

PHASES = {
    "fase1": (439700, 4474100, 440700, 4474900),
    "fase2": (439316, 4473866, 441428, 4474730),
}

tr = Transformer.from_crs("EPSG:25830", "EPSG:4326", always_xy=True)
for name, (x0, y0, x1, y1) in PHASES.items():
    lon0, lat0 = tr.transform(x0, y0)
    lon1, lat1 = tr.transform(x1, y1)
    print(f"  {name}: {{ wgs84: {{ xMin: {lon0:.6f}, yMin: {lat0:.6f}, xMax: {lon1:.6f}, yMax: {lat1:.6f} }}, utm: [{x0}, {y0}, {x1}, {y1}] }},")
