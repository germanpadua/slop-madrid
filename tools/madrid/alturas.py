#!/usr/bin/env python3
# tools/madrid/alturas.py — page the Ayuntamiento de Madrid MapServer
# CARTOGRAFIA/EDIFICIOS_ALTURAS (layer 0) for building footprints with ALTURA (m) in a bbox.
# usage: python3 alturas.py "x0,y0,x1,y1" out.json     (bbox in EPSG:25830 meters)
import json
import sys
import urllib.parse
import time
import urllib.request

URL = "https://sigma.madrid.es/hosted/rest/services/CARTOGRAFIA/EDIFICIOS_ALTURAS/MapServer/0/query"
PAGE = 2000  # server maxRecordCount


def query(bbox, offset):
    qs = urllib.parse.urlencode({
        "where": "1=1",
        "geometry": bbox.replace(" ", ""),
        "geometryType": "esriGeometryEnvelope",
        "inSR": "25830",
        "outSR": "25830",
        "outFields": "ALTURA,Z_EDIFICIO_HUELLA,ORIGEN,ID_3D",
        "returnGeometry": "true",
        "resultOffset": offset,
        "f": "json",
    })
    req = urllib.request.Request(URL + "?" + qs, headers={"User-Agent": "slop-madrid/1.0"})
    last = None
    for attempt in range(4):
        try:
            return json.loads(urllib.request.urlopen(req, timeout=120).read())
        except Exception as exc:  # transient IDEAM drops; same policy as catastro.py
            last = exc
            time.sleep(3 * (attempt + 1))
    raise last


def main():
    bbox = sys.argv[1].replace(" ", "")
    outpath = sys.argv[2]
    x0, y0, x1, y1 = bbox.split(",")

    features = []
    offset = 0
    while True:
        d = query(bbox, offset)
        if d.get("error"):
            raise SystemExit(f"server error: {d['error']}")
        feats = d.get("features", [])
        features.extend(feats)
        print(f"offset {offset}: +{len(feats)} (exceeded {d.get('exceededTransferLimit')})", flush=True)
        if len(feats) < PAGE:
            break
        offset += PAGE

    with open(outpath, "w") as fh:
        json.dump({"count": len(features), "crs": "EPSG:25830", "bbox": [x0, y0, x1, y1], "features": features}, fh)
    print(f"wrote {outpath}: {len(features)} footprints")


if __name__ == "__main__":
    main()
