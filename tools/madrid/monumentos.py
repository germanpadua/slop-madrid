#!/usr/bin/env python3
"""tools/madrid/monumentos.py — real municipal monument meshes for the Madrid web scene.

The hitos of the almendra were generic extrusions of their OSM/IDEAM footprints. This pipeline pulls the real
meshes from the Ayuntamiento de Madrid's I3S (ArcGIS SceneServer) services, crops them to the monument, simplifies
them to the per-file budget, quantises them (decimetres + vertex colours) and writes one ES module per monument to
js/monumentos/. Raw nodes are cached in /tmp, never in the repository.

Sources (anonymous, no API key):
  - Conjunto_Fuente_Cibeles_sin_textura  -> Cibeles fountain ensemble (statue, lions, chariot, basin)
  - P_Alcala_st                          -> Puerta de Alcalá (untextured)
  - MODELADO_3D_MADRID                   -> the municipal building model: Palacio Real + Almudena, Banco de
                                            España and the Atocha station head. The model is buildings only: it has
                                            no geometry for the Neptuno fountain, the Debod temple or the Cervantes
                                            monument (recorded in tools/madrid/monumentos.json as `missing`).

Frame: identical to tools/madrid/build.mjs — EPSG:25830 translated to Puerta del Sol, x = east, z = south,
1 unit = 1 m. I3S positions are lon/lat offsets from each node's mbs; the height is EGM96 metres.

Decimation: grid vertex clustering (numpy) on the world triangles, then a weld on the 0.1 m quantisation grid.
The cell grows until the encoded module fits --budget. Bases are flattened per source feature (one building each),
so every monument stands on the simulation's flat ground without floating or sinking.

usage:
  /usr/bin/python3 tools/madrid/monumentos.py                # all monuments
  /usr/bin/python3 tools/madrid/monumentos.py --only cibeles --budget 240
  /usr/bin/python3 tools/madrid/monumentos.py --list
"""
import argparse
import base64
import concurrent.futures
import hashlib
import json
import math
import os
import struct
import sys
import time

import numpy as np
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT_DIR = os.path.join(ROOT, 'js', 'monumentos')
MANIFEST = os.path.join(HERE, 'monumentos.json')
TILES = os.path.join(HERE, 'tiles.json')
GEODATA = os.path.join(ROOT, 'js', 'madrid-geodata.js')
CACHE = os.environ.get('MADRID_I3S_CACHE', '/tmp/madrid-i3s')

ARCGIS = 'https://tiles-eu1.arcgis.com/UrtTdLP2PYSxwtI6/arcgis/rest/services/%s/SceneServer/layers/0'
CITY = 'MODELADO_3D_MADRID'
SOURCE = 'Ayuntamiento de Madrid, Modelado 3D del municipio (IDEAM / ArcGIS SceneServer, i3s)'
LICENSE = '© Ayuntamiento de Madrid — reutilización con atribución (datos.madrid.es, condiciones generales)'
ATTRIBUTION = 'Geometría: © Ayuntamiento de Madrid (Modelado 3D). Colores estilizados, no material original.'

# ---------------------------------------------------------------------------------------------------------------------
# Monuments. `bbox` is world metres [x0, z0, x1, z1]; `clip` either 'all' (a dedicated per-monument service), a list
# of GEO.landmarks footprints (+ buffer) or 'bbox'. `max_leaf_radius` keeps the finest I3S level that covers the area.
# ---------------------------------------------------------------------------------------------------------------------
MONUMENTS = {
    'cibeles': {
        'name': 'Fuente de Cibeles',
        'label': 'Cibeles (plaza y fuente)',
        'service': 'Conjunto_Fuente_Cibeles_sin_textura',
        'bbox': (880.0, -300.0, 940.0, -250.0),
        'clip': 'all',
        'palette': 'fountain',
        'max_leaf_radius': 60,
        'start_cell': 0.10,
        'base_percentile': 0,
    },
    'alcala': {
        'name': 'Puerta de Alcalá',
        'label': 'Puerta de Alcalá',
        'service': 'P_Alcala_st',
        'bbox': (1250.0, -390.0, 1310.0, -305.0),
        'clip': 'all',
        'palette': 'gate',
        'max_leaf_radius': 60,
        'start_cell': 0.10,
        'base_percentile': 0,
    },
    'palacio': {
        'name': 'Palacio Real y Catedral de la Almudena',
        'label': 'Palacio Real + Almudena',
        'service': CITY,
        'bbox': (-995.0, -275.0, -805.0, 175.0),
        'clip': ['Palacio Real', 'Catedral de la Almudena'],
        'buffer': 6.0,
        'palette': 'stone',
        'max_leaf_radius': 350,
        'start_cell': 0.18,
        'base_percentile': 5,
    },
    'banco': {
        'name': 'Banco de España',
        'label': 'Banco de España',
        'service': CITY,
        'bbox': (675.0, -245.0, 850.0, -60.0),
        'clip': ['Banco de España'],
        'buffer': 6.0,
        'palette': 'stone',
        'max_leaf_radius': 350,
        'start_cell': 0.18,
        'base_percentile': 5,
    },
}

# Monuments named in the brief that no public Ayuntamiento 3D layer contains (or contains faithfully). Kept here so the
# manifest, the docs and the tests agree on the exact gap; the website keeps no invented mass for them.
MISSING = {
    'neptuno': {
        'name': 'Fuente de Neptuno',
        'reason': 'El MODELADO_3D_MADRID es solo edificación: la fuente no tiene geometría en el servicio dedicado '
                  '(0 triángulos en su recinto). No hay SceneServer municipal de la fuente de Neptuno.',
    },
    'debod': {
        'name': 'Templo de Debod',
        'reason': 'Sin malla en el MODELADO_3D_MADRID (0 triángulos en el recinto) ni en los servicios 2023 del '
                  'parque; no hay SceneServer municipal del templo.',
    },
    'atocha': {
        'name': 'Estación de Atocha (fachada histórica y reloj)',
        'reason': 'El MODELADO_3D_MADRID no modela la fachada de 1892 con el reloj: en su recinto solo hay naves, el '
                  'invernadero y un anexo alto sin relación con la fachada. El único servicio dedicado de la zona '
                  '(SG_INNOVACION_ATOCHA_CARLOSV) es una nube de puntos, no una malla. Se deja fuera antes que '
                  'publicar una torre que no existe.',
    },
    'plazaespana': {
        'name': 'Monumento a Cervantes (Plaza de España)',
        'reason': 'El MODELADO_3D_MADRID no contiene el monumento (0 triángulos en su recinto); no hay servicio '
                  'municipal del conjunto escultórico.',
    },
}

# I3S height model is EGM96 orthometric; the world's ground is y = 0 per monument. Nothing else is converted.
SERVICE_LAYER = ARCGIS

# =====================================================================================================================
# Frame (identical series to tools/madrid/projection.mjs; verified against config.mjs corners by tools tests).
# =====================================================================================================================
A = 6378137.0
F = 1 / 298.257223563
E2 = 2 * F - F * F
EP2 = E2 / (1 - E2)
K0 = 0.9996
LON0 = math.radians(-3)


def utm_forward(lon, lat):
    lon = np.asarray(lon, dtype=np.float64)
    lat = np.asarray(lat, dtype=np.float64)
    phi = np.radians(lat)
    lam = np.radians(lon)
    sp = np.sin(phi)
    cp = np.cos(phi)
    tp = np.tan(phi)
    n = A / np.sqrt(1 - E2 * sp * sp)
    t = tp * tp
    c = EP2 * cp * cp
    m = A * ((1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256) * phi
             - (3 * E2 / 8 + 3 * E2 * E2 / 32 + 45 * E2 ** 3 / 1024) * np.sin(2 * phi)
             + (15 * E2 * E2 / 256 + 45 * E2 ** 3 / 1024) * np.sin(4 * phi)
             - (35 * E2 ** 3 / 3072) * np.sin(6 * phi))
    dl = lam - LON0
    a2 = dl * cp
    x = K0 * n * (a2 + (1 - t + c) * a2 ** 3 / 6 + (5 - 18 * t + t * t + 72 * c - 58 * EP2) * a2 ** 5 / 120) + 500000
    y = K0 * (m + n * tp * (a2 * a2 / 2 + (5 - t + 9 * c + 4 * c * c) * a2 ** 4 / 24
                            + (61 - 58 * t + t * t + 600 * c - 330 * EP2) * a2 ** 6 / 720))
    return x, y


def utm_inverse(e, n):
    m = n / K0
    mu = m / (A * (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256))
    e1 = (1 - math.sqrt(1 - E2)) / (1 + math.sqrt(1 - E2))
    phi1 = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu)
            + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
            + (151 * e1 ** 3 / 96) * math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
    sp = math.sin(phi1)
    cp = math.cos(phi1)
    tp = math.tan(phi1)
    c1 = EP2 * cp * cp
    t1 = tp * tp
    n1 = A / math.sqrt(1 - E2 * sp * sp)
    r1 = A * (1 - E2) / (1 - E2 * sp * sp) ** 1.5
    d = (e - 500000) / (n1 * K0)
    lat = phi1 - (n1 * tp / r1) * (d * d / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4 / 24
                                   + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6 / 720)
    lon = ((d - (1 + 2 * t1 + c1) * d ** 3 / 6
            + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5 / 120) / cp + LON0)
    return math.degrees(lon), math.degrees(lat)


SOLX, SOLY = (float(v) for v in utm_forward(-3.7037900, 40.4167750))


def world_of(bbox):
    """World rectangle -> WGS84 (lon0, lon1, lat0, lat1), the envelope used to prune the quadtree."""
    x0, z0, x1, z1 = bbox
    lon0, lat0 = utm_inverse(SOLX + x0, SOLY - z1)
    lon1, lat1 = utm_inverse(SOLX + x1, SOLY - z0)
    return lon0, lon1, lat0, lat1


def log(*a):
    print('[monumentos]', *a, flush=True)


# =====================================================================================================================
# I3S client: node tree, geometry download, cache in /tmp (never in Git).
# =====================================================================================================================
def cache_dir(service):
    path = os.path.join(CACHE, service)
    os.makedirs(path, exist_ok=True)
    return path


def fetch_node(base, node_id):
    path = os.path.join(cache_dir(base.rsplit('/services/', 1)[1].split('/')[0]), node_id.replace('/', '_') + '.json')
    if os.path.exists(path):
        return json.load(open(path))
    res = requests.get(base + '/nodes/' + node_id, timeout=60)
    res.raise_for_status()
    data = res.json()
    if 'error' in data:
        raise RuntimeError(f'{node_id}: {data["error"].get("message")}')
    json.dump(data, open(path, 'w'))
    return data


def fetch_geometry(base, node_id):
    path = os.path.join(cache_dir(base.rsplit('/services/', 1)[1].split('/')[0]), node_id.replace('/', '_') + '.bin')
    if not os.path.exists(path):
        res = requests.get(base + '/nodes/' + node_id + '/geometries/0', timeout=600)
        if res.status_code != 200:
            return None
        tmp = path + '.part'
        open(tmp, 'wb').write(res.content)
        os.rename(tmp, path)
    return open(path, 'rb').read()


def leaves_for(base, bbox):
    """Every geometry node under `bbox`, descending all the way (the server serves finer LODs as children)."""
    lon0, lon1, lat0, lat1 = world_of(bbox)
    root = fetch_node(base, 'root')
    if 'mbs' not in root:
        raise RuntimeError(f'{base}: no root mbs ({root.get("error")})')

    def intersects(child):
        x, y, _z, r = child['mbs']
        return (x + r / 84000.0 > lon0 and x - r / 84000.0 < lon1
                and y + r / 111000.0 > lat0 and y - r / 111000.0 < lat1)

    queue = [c['id'] for c in root.get('children', []) if intersects(c)]
    out, seen = [], set()
    while queue:
        node_id = queue.pop(0)
        if node_id in seen:
            continue
        seen.add(node_id)
        node = fetch_node(base, node_id)
        children = [c['id'] for c in node.get('children', []) if intersects(c)]
        if children:
            queue.extend(children)
        elif node.get('geometryData'):
            out.append(node)
    return out


def decode(raw, mbs):
    """I3S geometry -> world triangles (n,3,3) and the source-feature id of every triangle."""
    nv, nf = struct.unpack('<II', raw[:8])
    expect = 8 + nv * 36 + nf * 16
    if len(raw) < expect:
        raise ValueError(f'short geometry: {len(raw)} < {expect} (nv={nv}, nf={nf})')
    pos = np.frombuffer(raw, dtype='<f4', count=nv * 3, offset=8).reshape(-1, 3).astype(np.float64)
    ranges = np.frombuffer(raw, dtype='<u4', count=nf * 2, offset=8 + nv * 36 + nf * 8).reshape(-1, 2)
    tris = nv // 3
    feature = np.full(tris, -1, dtype=np.int32)
    for i, (a, b) in enumerate(ranges):
        a, b = int(a), min(int(b), tris - 1)
        if b >= a:
            feature[a:b + 1] = i
    e, n = utm_forward(mbs[0] + pos[:, 0], mbs[1] + pos[:, 1])
    v = np.column_stack((e - SOLX, mbs[2] + pos[:, 2], SOLY - n))
    return v.reshape(-1, 3, 3), feature, nv, nf


def ring_of(landmarks, name):
    lm = landmarks.get(name)
    if not lm or not lm.get('ring') or len(lm['ring']) < 6:
        raise KeyError(f'GEO.landmarks has no footprint {name!r}')
    r = lm['ring']
    return [(r[i], r[i + 1]) for i in range(0, len(r), 2)]


def point_in_ring(ring, x, z):
    inside = np.zeros(len(x), dtype=bool)
    j = len(ring) - 1
    with np.errstate(divide='ignore', invalid='ignore'):
        for i in range(len(ring)):
            xi, zi = ring[i]
            xj, zj = ring[j]
            inside ^= ((zi > z) != (zj > z)) & (x < ((xj - xi) * (z - zi) / (zj - zi) + xi))
            j = i
    return inside


def ring_distance(ring, x, z):
    best = np.full(len(x), np.inf)
    for i in range(len(ring)):
        ax, az = ring[i - 1]
        bx, bz = ring[i]
        dx, dz = bx - ax, bz - az
        l2 = dx * dx + dz * dz or 1.0
        t = np.clip(((x - ax) * dx + (z - az) * dz) / l2, 0.0, 1.0)
        best = np.minimum(best, np.hypot(ax + t * dx - x, az + t * dz - z))
    return best


# =====================================================================================================================
# Decimation, colours, quantisation.
# =====================================================================================================================
def cluster(tris, cell):
    """Grid vertex clustering: one vertex per occupied cell, triangles on their three cells."""
    v = tris.reshape(-1, 3)
    keys = np.floor(v / cell).astype(np.int64)
    packed = np.ascontiguousarray(keys).view([('a', np.int64), ('b', np.int64), ('c', np.int64)]).reshape(-1)
    _uniq, inverse = np.unique(packed, return_inverse=True)
    inverse = inverse.reshape(-1, 3)
    n = int(inverse.max()) + 1
    sums = np.zeros((n, 3))
    counts = np.zeros(n)
    np.add.at(sums, inverse.ravel(), v)
    np.add.at(counts, inverse.ravel(), 1)
    centres = sums / counts[:, None]
    degenerate = (inverse[:, 0] == inverse[:, 1]) | (inverse[:, 1] == inverse[:, 2]) | (inverse[:, 0] == inverse[:, 2])
    return centres, inverse[~degenerate]


def weld(vertices, index, quantum=0.1):
    """Weld on the output quantisation grid and drop duplicated / degenerate triangles."""
    q = np.round(vertices / quantum).astype(np.int64)
    packed = np.ascontiguousarray(q).view([('a', np.int64), ('b', np.int64), ('c', np.int64)]).reshape(-1)
    _uniq, inverse = np.unique(packed, return_inverse=True)
    inv = inverse.reshape(-1)
    tri = inv[index]
    keep = (tri[:, 0] != tri[:, 1]) & (tri[:, 1] != tri[:, 2]) & (tri[:, 0] != tri[:, 2])
    tri = tri[keep]
    ordered = np.sort(tri, axis=1)
    _rows, first = np.unique(ordered, axis=0, return_index=True)
    tri = tri[np.sort(first)]
    # Average the positions that share a quantisation cell.
    pos = np.zeros((len(_uniq), 3))
    cnt = np.zeros(len(_uniq))
    np.add.at(pos, inv, vertices)
    np.add.at(cnt, inv, 1)
    pos /= np.maximum(cnt, 1)[:, None]
    return pos, tri


def palette_color(palette, normals, y, height):
    wall, roof, accent = PALETTES[palette]
    up = normals[:, 1]
    colors = np.tile(np.array(wall, dtype=np.float64), (len(normals), 1))
    colors[up > 0.55] = roof
    colors[up < -0.25] = np.array(wall) * 0.72
    high = (y > height * 0.62) & (up <= 0.55)
    colors[high] = accent
    # Subtle vertical light and per-triangle variation keep the flat palette from looking like a single material.
    t = np.clip(y / max(height, 1e-6), 0, 1)
    jitter = 0.97 + 0.06 * ((np.sin(y * 12.9898 + normals[:, 0] * 37.719) * 43758.5453) % 1.0)
    colors *= (0.95 + 0.07 * t)[:, None] * jitter[:, None]
    return np.clip(colors, 0, 255)


PALETTES = {
    'fountain': ((203, 196, 180), (150, 144, 132), (182, 174, 158)),
    'gate': ((219, 208, 186), (146, 138, 122), (199, 188, 168)),
    'stone': ((211, 201, 183), (128, 120, 109), (186, 176, 160)),
}


def build(monument_id, cfg, landmarks, budget):
    service = cfg['service']
    base = SERVICE_LAYER % service
    t0 = time.time()
    bbox = cfg['bbox']
    leaves = leaves_for(base, bbox)
    finest = [n for n in leaves if n['mbs'][3] <= cfg['max_leaf_radius']]
    if finest:
        leaves = finest
    elif leaves:
        smallest = min(n['mbs'][3] for n in leaves)
        leaves = [n for n in leaves if n['mbs'][3] <= smallest * 1.5]
    if not leaves:
        raise RuntimeError(f'{monument_id}: no geometry node intersects {bbox}')
    log(f'{monument_id}: {len(leaves)} I3S nodes <= {max(n["mbs"][3] for n in leaves):.0f} m')

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        raws = list(pool.map(lambda n: fetch_geometry(base, n['id']), leaves))

    chunks, features = [], []
    offset = 0
    for node, raw in zip(leaves, raws):
        if not raw:
            continue
        tris, feature, _nv, _nf = decode(raw, node['mbs'])
        chunks.append(tris)
        features.append(feature + offset)
        offset += int(feature.max()) + 1 if len(feature) else 0
    if not chunks:
        raise RuntimeError(f'{monument_id}: every node returned no geometry')
    tris = np.concatenate(chunks)
    feature = np.concatenate(features)
    raw_tris = len(tris)

    # Crop. A dedicated monument service is the object itself; the city model is cropped by footprint (+ buffer).
    cent = tris.mean(axis=1)
    clip = cfg['clip']
    if clip == 'all':
        keep = np.ones(len(tris), dtype=bool)
    elif clip == 'bbox':
        keep = ((cent[:, 0] > bbox[0]) & (cent[:, 0] < bbox[2])
                & (cent[:, 2] > bbox[1]) & (cent[:, 2] < bbox[3]))
    else:
        buf = float(cfg.get('buffer', 0))
        keep = np.zeros(len(tris), dtype=bool)
        for name in clip:
            ring = ring_of(landmarks, name)
            keep |= point_in_ring(ring, cent[:, 0], cent[:, 2])
            if buf > 0:
                keep |= ring_distance(ring, cent[:, 0], cent[:, 2]) <= buf
    tris = tris[keep]
    feature = feature[keep]
    if not len(tris):
        raise RuntimeError(f'{monument_id}: nothing left after cropping to {bbox}')
    clipped = len(tris)

    # Flatten per source feature: each building's own base sits on the simulation's flat ground. A city-model
    # feature may include underground levels (parking, crypts): `base_percentile` puts the street level on y = 0 and
    # leaves the buried part below it instead of turning it into a plinth.
    pct = float(cfg.get('base_percentile', 0))
    uniq, inverse = np.unique(feature, return_inverse=True)
    if pct > 0:
        base_y = np.zeros(len(uniq))
        for i in range(len(uniq)):
            base_y[i] = np.percentile(tris[inverse == i][:, :, 1], pct)
    else:
        base_y = np.full(len(uniq), np.inf)
        np.minimum.at(base_y, inverse, tris[:, :, 1].min(axis=1))
    tris[:, :, 1] -= base_y[inverse][:, None]

    cell = float(cfg['start_cell'])
    attempt = 0
    while True:
        attempt += 1
        centres, index = cluster(tris, cell)
        pos, tri = weld(centres, index)
        # Colour by triangle normal / height.
        t = pos[tri]
        normals = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
        lens = np.linalg.norm(normals, axis=1)
        normals /= np.maximum(lens, 1e-9)[:, None]
        height = float(pos[:, 1].max())
        tri_y = t[:, :, 1].mean(axis=1)
        tri_col = palette_color(cfg['palette'], normals, tri_y, height)
        # Accumulate triangle colours on the welded vertices.
        col = np.zeros((len(pos), 3))
        cnt = np.zeros(len(pos))
        np.add.at(col, tri.ravel(), np.repeat(tri_col, 3, axis=0))
        np.add.at(cnt, tri.ravel(), 1)
        col = col / np.maximum(cnt, 1)[:, None]

        origin = np.array([pos[:, 0].min(), 0.0, pos[:, 2].min()])
        quant = np.round(np.column_stack((pos[:, 0] - origin[0], pos[:, 1], pos[:, 2] - origin[2])) / 0.1).astype(np.int64)
        if quant.max() > 32767 or quant.min() < -32768:
            raise RuntimeError(f'{monument_id}: local extent does not fit int16 decimetres')
        positions = quant.astype('<i2').tobytes()
        colors = np.clip(col, 0, 255).astype(np.uint8).tobytes()
        index_bits = 16 if len(pos) < 65536 else 32
        indices = tri.astype('<u2' if index_bits == 16 else '<u4').tobytes()
        bounds = [float(origin[0]), float(origin[2]),
                  float(origin[0] + quant[:, 0].max() * 0.1), float(origin[2] + quant[:, 2].max() * 0.1)]
        height = float(quant[:, 1].max()) * 0.1
        module = render_module(monument_id, cfg, service, origin, bounds, height, positions, colors, indices,
                               len(pos), len(tri), index_bits)
        size = len(module.encode())
        if size <= budget:
            break
        if attempt >= 40:
            raise RuntimeError(f'{monument_id}: cannot meet {budget} B (cell {cell:.2f} -> {size} B)')
        cell *= 1.25

    # Local z is world south; the quantiser uses the same axis, so bounds stay in world metres.
    out = {
        'id': monument_id,
        'name': cfg['name'],
        'label': cfg['label'],
        'service': service,
        'origin': [float(origin[0]), float(origin[1]), float(origin[2])],
        'bounds': bounds,
        'height': height,
        'triangles': int(len(tri)),
        'vertices': int(len(pos)),
        'indexBits': index_bits,
        'cell': round(cell, 3),
        'rawTriangles': int(raw_tris),
        'clippedTriangles': int(clipped),
        'bytes': size,
        'module': f'js/monumentos/m-{monument_id}.js',
        'elapsed': round(time.time() - t0, 1),
        'md5': hashlib.md5(module.encode()).hexdigest(),
    }
    log(f'{monument_id}: {raw_tris} raw -> {clipped} cropped -> {len(tri)} tris, '
        f'{len(pos)} verts, cell {cell:.2f} m, {size} B, {out["elapsed"]} s')
    return module, out


def render_module(monument_id, cfg, service, origin, bounds, height, positions, colors, indices, vertex_count, tri_count, index_bits):
    def b64(b):
        return base64.b64encode(b).decode('ascii')

    header = (
        f"// js/monumentos/m-{monument_id}.js — GENERATED by tools/madrid/monumentos.py, do not edit by hand.\n"
        f"// {cfg['name']} ({cfg['label']}). Source: {service} (i3s, EPSG:4326, EGM96 heights).\n"
        f"// {LICENSE}\n"
        f"// Simplified municipal mesh: quantised positions (decimetres, int16) + vertex colours; colours are stylised.\n"
    )
    body = (
        'export const MONUMENT = {\n'
        f"  id: {json.dumps(monument_id)},\n"
        f"  name: {json.dumps(cfg['name'], ensure_ascii=False)},\n"
        f"  label: {json.dumps(cfg['label'], ensure_ascii=False)},\n"
        f"  service: {json.dumps(service)},\n"
        f"  origin: [{origin[0]:.2f}, {origin[1]:.2f}, {origin[2]:.2f}],\n"
        f"  bounds: [{bounds[0]:.2f}, {bounds[1]:.2f}, {bounds[2]:.2f}, {bounds[3]:.2f}],\n"
        f"  height: {height:.2f},\n"
        f"  quantum: 0.1,\n"
        f"  vertices: {vertex_count},\n"
        f"  triangles: {tri_count},\n"
        f"  indexBits: {index_bits},\n"
        f"  positions: \"{b64(positions)}\",\n"
        f"  colors: \"{b64(colors)}\",\n"
        f"  indices: \"{b64(indices)}\",\n"
        f"  attribution: {json.dumps(ATTRIBUTION, ensure_ascii=False)}\n"
        '};\n'
    )
    return header + body


def load_landmarks():
    src = open(GEODATA).read()
    start = src.index('export const GEO = ') + len('export const GEO = ')
    end = src.index(';\n', start)
    return json.loads(src[start:end])['landmarks']


def tile_for(bbox):
    manifest = json.load(open(TILES))
    cx = (bbox[0] + bbox[2]) / 2
    cz = (bbox[1] + bbox[3]) / 2
    for tile in manifest['tiles']:
        for x0, z0, x1, z1 in tile.get('core') or []:
            if x0 <= cx <= x1 and z0 <= cz <= z1:
                return tile['id']
    return manifest['grid'].get('seed', 'fase2')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', action='append', default=None, help='monument id(s); default all')
    ap.add_argument('--budget', type=int, default=245 * 1024, help='max bytes per module (default 245 KiB)')
    ap.add_argument('--list', action='store_true')
    args = ap.parse_args()
    if args.list:
        for key, cfg in MONUMENTS.items():
            print(key, cfg['label'], cfg['service'], cfg['bbox'])
        for key, cfg in MISSING.items():
            print(key, cfg['name'], '(missing in the municipal model)')
        return

    os.makedirs(OUT_DIR, exist_ok=True)
    landmarks = load_landmarks()
    ids = args.only or list(MONUMENTS)
    results, failures = [], {}
    for monument_id in ids:
        if monument_id not in MONUMENTS:
            raise SystemExit(f'unknown monument {monument_id!r} (see --list)')
        cfg = MONUMENTS[monument_id]
        try:
            module, meta = build(monument_id, cfg, landmarks, args.budget)
        except Exception as err:  # documented and skipped: the rest of the pipeline keeps going
            log(f'{monument_id}: FAILED {err}')
            failures[monument_id] = str(err)
            continue
        path = os.path.join(ROOT, meta['module'])
        open(path, 'w').write(module)
        meta['tile'] = tile_for(cfg['bbox'])
        results.append(meta)

    if not args.only:
        total = sum(m['bytes'] for m in results)
        manifest = {
            'version': 1,
            'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'crs': 'EPSG:25830',
            'frame': 'Puerta del Sol, 1 unit = 1 m, x east, z south',
            'source': SOURCE,
            'license': LICENSE,
            'attribution': ATTRIBUTION,
            'budgetBytes': args.budget,
            'totals': {'monuments': len(results), 'bytes': total, 'triangles': sum(m['triangles'] for m in results)},
            'monuments': sorted(results, key=lambda m: m['id']),
            'missing': [dict(id=k, **v) for k, v in MISSING.items()],
            'failures': failures,
        }
        json.dump(manifest, open(MANIFEST, 'w'), ensure_ascii=False, indent=1)
        log(f'wrote {len(results)} modules, {total} B total -> {MANIFEST}')
        if failures:
            log(f'failures: {failures}')


if __name__ == '__main__':
    main()
