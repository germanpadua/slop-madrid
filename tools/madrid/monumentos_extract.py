#!/usr/bin/env python3
# tools/madrid/monumentos_extract.py — real decimated I3S meshes for the 8 Madrid monuments.
# Recipe adapted from tiny-madrid's extract_municipal_mesh.py (SceneServer MODELADO_3D_MADRID, no API key):
# quadtree traversal -> node geometry decode (position f32x3 / normal / uv0 / color, 36 B/vertex)
# -> crop by WGS84 bbox -> grid-cluster decimation to a per-mesh byte budget -> stylized palette.
# Output: tools/madrid/monumentos.json -> consumed by tools/madrid/monumentos_emit.py to write js/monumentos.js.
#
# Frame: world = meters relative to Puerta del Sol, x = east, z = south (north = -z), 1:1 (projection.mjs).
# Heights: orthometric-ish, y = mbs[2] + local z, re-based per mesh (y0 = min height in the bbox).
import json, math, struct, base64, os, sys, concurrent.futures
import numpy as np

BASE = 'https://tiles-eu1.arcgis.com/UrtTdLP2PYSxwtI6/arcgis/rest/services/MODELADO_3D_MADRID/SceneServer/layers/0'
CACHE = '/tmp/monumentos-nodes'
BUDGET = 250_000          # hard per-mesh budget (bytes of the emitted module data)
SOUP_BYTES = 9            # i16 x3 (dm) + u8 x3 per vertex
SOL = (-3.7037900, 40.4167750)   # Puerta del Sol (matches projection.mjs)

# WGS84 bboxes per monument, in world meters (x0, x1, z0, z1) — derived from GEO.landmarks rings
# (exact project frame) for the ones that exist; the rest from verified anchors (Círculo de Bellas
# Artes cross-check). 'skip' = GEO.landmarks entry whose box extrusion the real mesh replaces.
MONUMENTS = {
    'palacio-cibeles': dict(bbox=(932.0, 1082.0, -302.0, -140.0), skip='Palacio de Cibeles'),
    'palacio-real':    dict(bbox=(-1000.0, -800.0, -282.0, -22.0), skip='Palacio Real'),
    'almudena':        dict(bbox=(-991.3, -826.4, 42.2, 178.9), skip='Catedral de la Almudena'),
    'plaza-espana':    dict(bbox=(-795.0, -535.0, -766.0, -590.0)),
    'atocha':          dict(bbox=(1027.0, 1438.0, 1122.0, 1610.0), skip='Estación de Atocha'),
    'banco-espana':    dict(bbox=(675.0, 850.0, -250.0, -61.0), skip='Banco de España'),
    'metropolis':      dict(bbox=(645.0, 715.0, -218.0, -148.0)),
}

os.makedirs(CACHE, exist_ok=True)

def http(url, binary=False, tries=3):
    import urllib.request, gzip
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=40) as r:
                raw = r.read()
                if raw[:2] == b'\x1f\x8b': raw = gzip.decompress(raw)
                return raw if binary else json.loads(raw)
        except Exception as e:  # transient 5xx / TLS hiccups
            last = e
    raise RuntimeError(f'{url}: {last}')

def getnode(cid):
    p = f'{CACHE}/{cid}.json'
    if os.path.exists(p): return json.load(open(p))
    j = http(f'{BASE}/nodes/{cid}')
    json.dump(j, open(p, 'w'))
    return j

def utm(lon, lat):
    """Snyder TM on WGS84 — exact replica of projection.mjs utmForward (node-verified)."""
    A = 6378137.0; F = 1 / 298.257223563; E2 = 2*F - F*F; EP2 = E2/(1-E2); K0 = 0.9996
    phi, lam = math.radians(lat), math.radians(lon)
    sp, cp, tp = math.sin(phi), math.cos(phi), math.tan(phi)
    N = A/math.sqrt(1 - E2*sp*sp); T = tp*tp; C = EP2*cp*cp
    M = A*((1 - E2/4 - 3*E2**2/64 - 5*E2**3/256)*phi
           - (3*E2/8 + 3*E2**2/32 + 45*E2**3/1024)*math.sin(2*phi)
           + (15*E2**2/256 + 45*E2**3/1024)*math.sin(4*phi)
           - 35*E2**3/3072*math.sin(6*phi))
    dl = lam - math.radians(-3); a2 = dl*cp
    x = K0*N*(a2 + (1-T+C)*a2**3/6 + (5-18*T+T*T+72*C-58*EP2)*a2**5/120) + 500000
    y = K0*(M + N*tp*(a2*a2/2 + (5-T+9*C+4*C*C)*a2**4/24 + (61-58*T+T*T+600*C-330*EP2)*a2**6/720))
    return x, y

# Vectorized variant for vertex clouds (numpy arrays of lon/lat degrees -> UTM).
def utm_vec(lon, lat):
    A = 6378137.0; F = 1 / 298.257223563; E2 = 2*F - F*F; EP2 = E2/(1-E2); K0 = 0.9996
    phi = np.radians(lat); lam = np.radians(lon)
    sp, cp, tp = np.sin(phi), np.cos(phi), np.tan(phi)
    N = A/np.sqrt(1 - E2*sp*sp); T = tp*tp; C = EP2*cp*cp
    M = A*((1 - E2/4 - 3*E2**2/64 - 5*E2**3/256)*phi
           - (3*E2/8 + 3*E2**2/32 + 45*E2**3/1024)*np.sin(2*phi)
           + (15*E2**2/256 + 45*E2**3/1024)*np.sin(4*phi)
           - 35*E2**3/3072*np.sin(6*phi))
    dl = lam - np.radians(-3); a2 = dl*cp
    x = K0*N*(a2 + (1-T+C)*a2**3/6 + (5-18*T+T*T+72*C-58*EP2)*a2**5/120) + 500000
    y = K0*(M + N*tp*(a2*a2/2 + (5-T+9*C+4*C*C)*a2**4/24 + (61-58*T+T*T+600*C-330*EP2)*a2**6/720))
    return x, y

SOL_UTM = utm(*SOL)

def world_center(lon, lat):
    x, y = utm(lon, lat)
    return x - SOL_UTM[0], -(y - SOL_UTM[1])

def intersects(mbs, bx):
    x0, x1, z0, z1 = bx
    cx, cz = world_center(mbs[0], mbs[1])
    re, rn = mbs[3] / 84000 * 84700.0, mbs[3] / 111000 * 111050.0  # radius: metres -> degrees at Madrid's lat
    return cx + re > x0 and cx - re < x1 and cz + rn > z0 and cz - rn < z1

def select_nodes(bx):
    root = http(f'{BASE}/nodes/root')
    q = [c for c in root.get('children', []) if intersects(c['mbs'], bx)]
    chosen = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        while q:
            nodes = list(ex.map(getnode, [c['id'] for c in q])); q = []
            for n in nodes:
                if n['mbs'][3] < 950 or not n.get('children'): chosen.append(n)
                else: q.extend(c for c in n['children'] if intersects(c['mbs'], bx))
    return chosen

def fetch_geom(n):
    cid = n['id']; p = f'{CACHE}/{cid}.bin'
    if not os.path.exists(p):
        open(p, 'wb').write(http(f'{BASE}/nodes/{cid}/geometries/0', binary=True))
    return n, p

def decode(n, p, bx):
    raw = open(p, 'rb').read()
    nv, nf = struct.unpack('<II', raw[:8])
    if not nv: return None
    v = np.frombuffer(raw, dtype='<f4', count=nv*3, offset=8).reshape(-1, 3).copy()
    # absolute lon/lat: local degree offsets + node mbs centre; height: local z + mbs z (metres)
    lon_abs = v[:, 0] + n['mbs'][0]
    lat_abs = v[:, 1] + n['mbs'][1]
    e, nn = utm_vec(lon_abs, lat_abs)
    x = e - SOL_UTM[0]               # world x (east of Sol)
    z = -(nn - SOL_UTM[1])           # world z (south of Sol)
    y = v[:, 2] + n['mbs'][2]
    tris = np.stack([x, y, z], 1).reshape(-1, 3, 3)
    cent = tris.mean(1)
    x0, x1, z0, z1 = bx
    keep = (cent[:, 0] > x0) & (cent[:, 0] < x1) & (cent[:, 2] > z0) & (cent[:, 2] < z1)
    tris = tris[keep]
    if not len(tris): return None
    return tris

WALL = np.array([[222,205,179],[220,195,167],[228,214,190],[204,192,174],[223,209,191]]) / 255.0
ROOF = np.array([[167,108,82],[185,127,92],[125,126,122],[165,143,112],[194,148,110]]) / 255.0

def decimate(tris, budget):
    c = 0.35
    while True:
        flat = tris.reshape(-1, 3)
        key = np.round(flat / c).astype(np.int64)
        uniq, inv = np.unique(key, axis=0, return_inverse=True)
        cnt = np.bincount(inv, minlength=len(uniq)).astype(np.float64)
        verts = np.stack([np.bincount(inv, weights=flat[:, k], minlength=len(uniq)) / cnt for k in range(3)], 1)
        faces = inv.reshape(-1, 3)
        faces = faces[(faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])]
        if len(verts) * SOUP_BYTES <= budget or c > 6:
            return verts, faces, c
        c *= 1.3

def paint(verts, faces):
    a, b, d = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
    n = np.cross(b - a, d - a)
    n /= np.maximum(np.linalg.norm(n, axis=1)[:, None], 1e-6)
    roof = np.abs(n[:, 1]) > 0.55
    var = np.arange(len(faces)) % 5
    col = WALL[var]
    col[roof] = ROOF[var[roof]]
    light = np.maximum(0.25, n @ np.array([-0.4, 0.86, -0.3]))
    col *= (0.78 + 0.22 * light)[:, None]
    return np.repeat(np.clip(col * 255, 0, 255).astype('uint8'), 3, axis=0)  # per vertex

def main():
    out = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        for mid, spec in MONUMENTS.items():
            x0, x1, z0, z1 = spec['bbox']
            cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
            nodes = select_nodes(spec['bbox'])
            geoms = list(ex.map(fetch_geom, nodes))
            tris = [t for t in (decode(n, p, spec['bbox']) for n, p in geoms) if t is not None]
            if not tris:
                print(f'{mid}: EMPTY', flush=True); continue
            soup = np.concatenate(tris).reshape(-1, 3)
            verts, faces, c = decimate(soup, BUDGET)
            cols = paint(verts, faces)
            y0 = float(verts[:, 1].min())
            vmin, vmax = verts.min(0), verts.max(0)
            # store positions in decimetres relative to the mesh origin (bbox centre in x/z, min height in y)
            packed = np.round(np.stack([
                (verts[:, 0] - cx) * 10,
                (verts[:, 1] - y0) * 10,
                (verts[:, 2] - cz) * 10], 1)).astype('<i2')
            size = [float(vmax[0] - vmin[0]), float(vmax[1] - y0), float(vmax[2] - vmin[2])]
            out[mid] = dict(
                origin=[round(cx, 1), round(cz, 1)],
                y0=round(y0, 1),
                cluster=round(c, 3), verts=int(len(verts)), tris=int(len(faces)),
                size=[round(s, 1) for s in size],
                skip=spec.get('skip'),
                pos=base64.b64encode(packed.tobytes()).decode(),
                col=base64.b64encode(cols.tobytes()).decode(),
            )
            data_kb = (len(verts) * SOUP_BYTES) / 1024
            print(f"{mid}: nodes={len(nodes)} tris={len(faces)} verts={len(verts)} cluster={c:.2f} data={data_kb:.0f} KB y0={y0:.0f} size={[round(s) for s in size]}", flush=True)
    json.dump(out, open('tools/madrid/monumentos.json', 'w'), separators=(',', ':'))
    print(f"total data: {sum(m['verts'] for m in out.values()) * SOUP_BYTES / 1024:.0f} KB across {len(out)} meshes")

if __name__ == '__main__':
    main()
