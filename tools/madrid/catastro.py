#!/usr/bin/env python3
# tools/madrid/catastro.py — page the INSPIRE WFS of the Dirección General del Catastro
# for building footprints (BU/Building) in a bbox, dedupe by gml:id, and store the raw
# <bu-ext2d:Building> XML members as JSON so the Node builder can re-parse them.
# usage: python3 catastro.py "x0,y0,x1,y1" out.json     (bbox in EPSG:25830 meters)
import json
import os
import subprocess
import sys
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
    data = urllib.request.urlopen(req, timeout=120).read()
    return ET.fromstring(data.decode("iso-8859-1"))


def main():
    bbox = sys.argv[1]
    outpath = sys.argv[2]
    x0, y0, x1, y1 = [float(v) for v in bbox.split(",")]

    seen = set()
    members = []
    pages = 0
    for gx in range(int((x1 - x0) // STEP) + 1):
        for gy in range(int((y1 - y0) // STEP) + 1):
            ax0, ay0 = x0 + gx * STEP, y0 + gy * STEP
            ax1, ay1 = min(ax0 + STEP, x1), min(ay0 + STEP, y1)
            root = wfs(ax0, ay0, ax1, ay1)
            feats = [m for fm in root.findall("gml:featureMember", NS) for m in fm]
            pages += 1
            new = 0
            for f in feats:
                fid = f.get(GID)
                if fid in seen:
                    continue
                seen.add(fid)
                new += 1
                members.append({"gmlId": fid, "gml": ET.tostring(f, encoding="unicode")})
            print(f"page {pages} ({ax0:.0f},{ay0:.0f})-({ax1:.0f},{ay1:.0f}): {len(feats)} features (+{new} new)", flush=True)

    os.makedirs(os.path.dirname(os.path.abspath(outpath)), exist_ok=True)
    with open(outpath, "w") as fh:
        json.dump({"count": len(members), "crs": "EPSG:25830", "bbox": [x0, y0, x1, y1], "features": members}, fh)
    print(f"wrote {outpath}: {len(members)} buildings from {pages} pages")


if __name__ == "__main__":
    main()
