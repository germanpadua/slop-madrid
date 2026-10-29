#!/usr/bin/env python3
# tools/madrid/catastro_cp.py — page the INSPIRE WFS of the Dirección General del Catastro
# for cadastral PLOT polygons (CP.CadastralParcel) in a bbox, dedupe by gml:id, and store
# the raw <cp:CadastralParcel> XML members as JSON so the Node builder can re-parse them.
# Same paging/retry/cache contract as catastro.py (BU buildings).
# usage: python3 catastro_cp.py "x0,y0,x1,y1" out.json     (bbox in EPSG:25830 meters)
# License (GetCapabilities AccessConstraints): https://www.catastro.hacienda.gob.es/webinspire/documentos/Licencia_en.pdf
# — one license for CP/AD/BU: transformed value-added products allowed (incl. commercial);
# raw original GML must not be redistributed (stays local under tools/data/madrid).
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

NS = {
    "gml": "http://www.opengis.net/gml/3.2",
    "wfs2": "http://www.opengis.net/wfs/2.0",
}
GID = "{http://www.opengis.net/gml/3.2}id"

STEP = 500  # meters per page — same contract as catastro.py


def wfs(x0, y0, x1, y1):
    qs = urllib.parse.urlencode({
        "service": "wfs", "version": "2", "request": "GetFeature",
        "typenames": "CP.CadastralParcel", "srsname": "urn:ogc:def:crs:EPSG::25830",
        "bbox": f"{x0},{y0},{x1},{y1},EPSG:25830", "count": 2500,
    })
    url = "https://ovc.catastro.meh.es/inspire/wfsCP.aspx?" + qs
    req = urllib.request.Request(url, headers={"User-Agent": "slop-madrid/1.0 (cadastral parcels)"})
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
    """Bounded recovery: split a failing page into quadrants (max depth 2)."""
    try:
        return [wfs(x0, y0, x1, y1)]
    except Exception:  # noqa: BLE001
        if depth >= 2:
            raise
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        roots = []
        for qx0, qy0, qx1, qy1 in ((x0, y0, mx, my), (mx, y0, x1, my),
                                   (x0, my, mx, y1), (mx, my, x1, y1)):
            roots.extend(wfs_deep(qx0, qy0, qx1, qy1, depth + 1))
        return roots


def members_of(root):
    # WFS 2.0 wraps features in wfs:member; WFS 1.x uses gml:featureMember. Accept both.
    for wrap in list(root):
        if wrap.tag.endswith("}member") or wrap.tag.endswith("}featureMember"):
            for f in list(wrap):
                yield f


def main():
    bbox = sys.argv[1]
    outpath = sys.argv[2]
    x0, y0, x1, y1 = [float(v) for v in bbox.split(",")]

    cachedir = os.path.join(os.path.dirname(os.path.abspath(outpath)), "catastro-cp-pages")
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
                                for r in roots for f in members_of(r)]
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
        print(f"INCOMPLETE: {len(missing)} CP pages unavailable: {missing}", flush=True)
        sys.exit(1)
    os.makedirs(os.path.dirname(os.path.abspath(outpath)), exist_ok=True)
    with open(outpath, "w") as fh:
        json.dump({"count": len(members), "crs": "EPSG:25830", "bbox": [x0, y0, x1, y1], "features": members}, fh)
    print(f"wrote {outpath}: {len(members)} parcels from {pages} pages")


if __name__ == "__main__":
    main()
