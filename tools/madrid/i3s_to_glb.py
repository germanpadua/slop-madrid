#!/usr/bin/env python3
"""Decode local i3s meshpyramids leaves -> assembled mesh -> optional voxel decimation -> GLB.
Positions are f32 offsets relative to each node's mbs center (lon/lat deg, z m); we refetch
node JSON for mbs. Output frame: meters relative to the crop center (x=east, y=up, z=south->north sign kept as -z north).
Usage: i3s_to_glb.py <dir> <lon0,lat0,lon1,lat1> <voxel_m|0> <out.glb>
"""
import json, struct, sys, urllib.request, gzip, os

BASE = ("https://tiles-eu1.arcgis.com/UrtTdLP2PYSxwtI6/arcgis/rest/services/"
        "MODELADO_3D_MADRID/SceneServer/layers/0")
UA = {"User-Agent": "slop-madrid/1.0 (landmark meshes)"}

def node_mbs(nid):
    req = urllib.request.Request(f"{BASE}/nodes/{nid}?f=json", headers={**UA, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    if data[:2] == b"\x1f\x8b": data = gzip.decompress(data)
    return json.loads(data.decode())["mbs"]

def main():
    d, bbox_s, voxel_s, out = sys.argv[1:5]
    lon0, lat0, lon1, lat1 = [float(v) for v in bbox_s.split(",")]
    voxel = float(voxel_s)
    idx = json.load(open(f"{d}/index.json"))
    P, C = [], []
    for leaf in idx["leaves"]:
        nid = leaf["node"]
        mbs = node_mbs(nid)
        raw = open(f"{d}/{nid}.bin", "rb").read()
        vcount, fcount = struct.unpack_from("<II", raw, 0)
        off = 8
        pos = struct.unpack_from(f"<{vcount*3}f", raw, off); off += vcount*12
        off += vcount*12  # normals
        off += vcount*8   # uv0
        col = struct.unpack_from(f"<{vcount*4}B", raw, off)
        cx, cy, cz, _r = mbs
        for i in range(vcount):
            x, y, z = pos[3*i] + cx, pos[3*i+1] + cy, pos[3*i+2] + cz  # lon, lat, h(m)
            if not (lon0 <= x <= lon1 and lat0 <= y <= lat1):
                continue
            P.append((x, y, z))
            C.append((col[4*i], col[4*i+1], col[4*i+2]))
    print(f"cropped verts: {len(P)} from {len(idx['leaves'])} leaves")
    if not P:
        print("empty crop"); return
    # reference frame: meters, x=east, y=up, z=north
    clon, clat = (lon0+lon1)/2, (lat0+lat1)/2
    mlat = 111320.0
    mlon = 111320.0 * __import__("math").cos(__import__("math").radians(clat))
    z0 = min(p[2] for p in P)
    V = [((p[0]-clon)*mlon, p[2]-z0, (p[1]-clat)*mlat) for p in P]
    # triangles: soup, 3 per face
    tris = [(i, i+1, i+2) for i in range(0, len(V) - len(V) % 3, 3)]
    if voxel > 0:
        key2new, Vn, Cn = {}, [], []
        remap = []
        for i, v in enumerate(V):
            k = (round(v[0]/voxel), round(v[1]/voxel), round(v[2]/voxel))
            j = key2new.get(k)
            if j is None:
                j = len(Vn); key2new[k] = j; Vn.append(list(v)); Cn.append(list(C[i])); remap.append(j)
            else:
                # average
                Vn[j][0] = (Vn[j][0] + v[0]) / 2; Vn[j][1] = (Vn[j][1] + v[1]) / 2; Vn[j][2] = (Vn[j][2] + v[2]) / 2
                Cn[j][0] = (Cn[j][0] + C[i][0]) // 2; Cn[j][1] = (Cn[j][1] + C[i][1]) // 2; Cn[j][2] = (Cn[j][2] + C[i][2]) // 2
                remap.append(j)
        tris2 = [(remap[a], remap[b], remap[c]) for (a, b, c) in tris]
        tris = [t for t in tris2 if t[0] != t[1] and t[1] != t[2] and t[0] != t[2]]
        V, C = Vn, [tuple(c) for c in Cn]
        print(f"decimated: {len(V)} verts, {len(tris)} tris")
    else:
        print(f"full: {len(V)} verts, {len(tris)} tris")
    # GLB (indexed)
    import math
    pos_b = b"".join(struct.pack("<3f", *v) for v in V)
    col_b = bytes(b for c in C for b in c)
    idx_b = b"".join(struct.pack("<3I", *t) for t in tris)
    def pad(b, fill=b"\x00"):
        return b + fill * ((4 - len(b) % 4) % 4)
    xs, ys, zs = [v[0] for v in V], [v[1] for v in V], [v[2] for v in V]
    gltf = {
        "asset": {"version": "2.0", "generator": "slop-madrid i3s_to_glb"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "COLOR_0": 1}, "indices": 2, "mode": 4}]}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos_b)},
            {"buffer": 0, "byteOffset": len(pad(pos_b)), "byteLength": len(col_b)},
            {"buffer": 0, "byteOffset": len(pad(pos_b)) + len(pad(col_b)), "byteLength": len(idx_b)},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(V), "type": "VEC3",
             "min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]},
            {"bufferView": 1, "componentType": 5121, "count": len(V), "type": "VEC3", "normalized": True},
            {"bufferView": 2, "componentType": 5125, "count": len(tris)*3, "type": "SCALAR"},
        ],
        "buffers": [{"byteLength": len(pad(pos_b)) + len(pad(col_b)) + len(pad(idx_b))}],
    }
    bin_chunk = pad(pos_b) + pad(col_b) + pad(idx_b)
    js = pad(json.dumps(gltf, separators=(",", ":")).encode(), b" ")
    glb = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_chunk))
    glb += struct.pack("<II", len(js), 0x4E4F534A) + js
    glb += struct.pack("<II", len(bin_chunk), 0x004E4942) + bin_chunk
    open(out, "wb").write(glb)
    print(f"wrote {out}: {len(glb)} B ({len(glb)/1e6:.2f} MB)")

if __name__ == "__main__":
    main()
