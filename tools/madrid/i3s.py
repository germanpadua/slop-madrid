#!/usr/bin/env python3
"""Fetch realistic 3D-mesh leaves (i3s meshpyramids, Ayuntamiento de Madrid,
anonymous access) for one landmark bbox and dump a decoded mesh package.

Usage: i3s.py <name> <lon0,lat0,lon1,lat1> <outdir>
Source: https://tiles-eu1.arcgis.com/UrtTdLP2PYSxwtI6/arcgis/rest/services/MODELADO_3D_MADRID/SceneServer/layers/0
Verified live 2026-10-28 (see MADRID.md "Modelo 3D realista (i3s)").
"""
import gzip
import json
import struct
import sys
import time
import urllib.request

BASE = ("https://tiles-eu1.arcgis.com/UrtTdLP2PYSxwtI6/arcgis/rest/services/"
        "MODELADO_3D_MADRID/SceneServer/layers/0")
UA = {"User-Agent": "slop-madrid/1.0 (landmark meshes)"}


def get_json(url):
    req = urllib.request.Request(url, headers={**UA, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
        if data[:2] == b"\x1f\x8b":
            data = gzip.decompress(data)
        return json.loads(data.decode())


def get_blob(url):
    req = urllib.request.Request(url, headers={**UA, "Accept-Encoding": "gzip"})
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
                return gzip.decompress(data) if data[:2] == b"\x1f\x8b" else data
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(2 * (attempt + 1))
    raise last


def hits(node, bbox):
    lon0, lat0, lon1, lat1 = bbox
    cx, cy, _z, r = node["mbs"]
    return not (cx + r / 111320 < lon0 or cx - r / 111320 > lon1
                or cy + r / 111320 < lat0 or cy - r / 111320 > lat1)


def main():
    name, bbox_s, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
    bbox = [float(v) for v in bbox_s.split(",")]

    leaves, queue, seen = [], ["root"], 0
    while queue and seen < 4000:
        nid = queue.pop(0)
        seen += 1
        node = get_json(f"{BASE}/nodes/{nid}?f=json")
        if not hits(node, bbox):
            continue
        children = node.get("children") or []
        if not children:
            leaves.append(node)
        else:
            queue.extend(c if isinstance(c, str) else c["id"] for c in children)
    print(f"{seen} nodes visited, {len(leaves)} leaves intersect {bbox}")

    import os
    os.makedirs(outdir, exist_ok=True)
    index = []
    for leaf in leaves:
        nid = leaf["id"]
        raw = get_blob(f"{BASE}/nodes/{nid}/geometries/0")
        # meshpyramids geometry: header uint32 vertexCount, uint32 featureCount, then
        # PerAttributeArray attributes (position f32 x3, normal f32 x3, uv0 f32 x2, color u8 x4)
        vcount, fcount = struct.unpack_from("<II", raw, 0)
        print(f"node {nid}: {len(raw)} B, {vcount} verts, {fcount} features")
        with open(f"{outdir}/{nid}.bin", "wb") as fh:
            fh.write(raw)
        index.append({"node": nid, "bytes": len(raw), "vertices": vcount, "features": fcount})
    with open(f"{outdir}/index.json", "w") as fh:
        json.dump({"name": name, "bbox": bbox, "leaves": index}, fh, indent=1)
    print(f"wrote {outdir}/index.json: {sum(l['bytes'] for l in index)} B total")


if __name__ == "__main__":
    main()
