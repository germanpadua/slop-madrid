#!/usr/bin/env python3
# tools/madrid/catastro.py — page the INSPIRE WFS of the Dirección General del Catastro
# for building footprints (BU/Building) in a bbox, dedupe by gml:id, and store the raw
# <bu-ext2d:Building> XML members as JSON so the Node builder can re-parse them.
# usage: python3 catastro.py "x0,y0,x1,y1" out.json     (bbox in EPSG:25830 meters)
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

NS = {
    "gml": "http://www.opengis.net/gml/3.2",
}
GID = "{http://www.opengis.net/gml/3.2}id"

STEP = 500  # meters per page — keeps each response small and reliable


def wfs(x0, y0, x1, y1, start=0):
    qs = urllib.parse.urlencode({
        "service": "wfs", "version": "2", "request": "GetFeature",
        "typenames": "Building", "srsname": "urn:ogc:def:crs:EPSG::25830",
        "bbox": f"{x0},{y0},{x1},{y1},EPSG:25830", "count": 2500, "startindex": start,
    })
    url = "https://ovc.catastro.meh.es/inspire/wfsBU.aspx?" + qs
    req = urllib.request.Request(url, headers={"User-Agent": "slop-madrid/1.0 (cadastral buildings)"})
    # The Catastro WFS drops connections under load; retry like the Overpass fetcher does.
    last = None
    for attempt in range(4):
        try:
            data = urllib.request.urlopen(req, timeout=120).read()
            return ET.fromstring(data.decode("iso-8859-1"))
        except Exception as exc:  # noqa: BLE001 - transient WFS failures are all retryable here
            last = exc
            time.sleep(3 * (attempt + 1))
    raise last


def wfs_deep(x0, y0, x1, y1, depth=0):
    """Bounded recovery: split a failing page into quadrants (max depth 2), then skip
    the sub-bbox with a loud warning instead of killing the whole tile build."""
    try:
        return [wfs(x0, y0, x1, y1)]
    except Exception as exc:  # noqa: BLE001
        if depth >= 2:
            raise
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        roots = []
        for qx0, qy0, qx1, qy1 in ((x0, y0, mx, my), (mx, y0, x1, my),
                                   (x0, my, mx, y1), (mx, my, x1, y1)):
            roots.extend(wfs_deep(qx0, qy0, qx1, qy1, depth + 1))
        return roots

def main():
    bbox = sys.argv[1]
    outpath = sys.argv[2]
    x0, y0, x1, y1 = [float(v) for v in bbox.split(",")]

    cachedir = os.path.join(os.path.dirname(os.path.abspath(outpath)), "catastro-pages")
    os.makedirs(cachedir, exist_ok=True)
    seen = set()
    members = []
    pages = 0
    missing = []
    for gx in range(int((x1 - x0) // STEP) + 1):
        for gy in range(int((y1 - y0) // STEP) + 1):
            ax0, ay0 = x0 + gx * STEP, y0 + gy * STEP
            ax1, ay1 = min(ax0 + STEP, x1), min(ay0 + STEP, y1)
            cache = os.path.join(cachedir, f"{ax0:.0f}_{ay0:.0f}_{ax1:.0f}_{ay1:.0f}.json")
            if os.path.exists(cache):
                page_members = json.load(open(cache))
            else:
                try:
                    roots = wfs_deep(ax0, ay0, ax1, ay1)
                except Exception as exc:  # noqa: BLE001
                    print(f"page UNAVAILABLE ({ax0:.0f},{ay0:.0f}): {exc}", flush=True)
                    missing.append((ax0, ay0))
                    continue
                page_members = [{"gmlId": f.get(GID), "gml": ET.tostring(f, encoding="unicode")}
                                for r in roots for fm in r.findall("gml:featureMember", NS) for f in fm]
                json.dump(page_members, open(cache, "w"))
            pages += 1
            new = 0
            for pm in page_members:
                if pm["gmlId"] in seen:
                    continue
                seen.add(pm["gmlId"])
                new += 1
                members.append(pm)
            print(f"page {pages} ({ax0:.0f},{ay0:.0f})-({ax1:.0f},{ay1:.0f}): {len(page_members)} features (+{new} new)", flush=True)

    if missing:
        print(f"INCOMPLETE: {len(missing)} catastro pages unavailable: {missing}", flush=True)
        sys.exit(1)
    os.makedirs(os.path.dirname(os.path.abspath(outpath)), exist_ok=True)
    with open(outpath, "w") as fh:
        json.dump({"count": len(members), "crs": "EPSG:25830", "bbox": [x0, y0, x1, y1], "features": members}, fh)
    print(f"wrote {outpath}: {len(members)} buildings from {pages} pages")


if __name__ == "__main__":
    main()
