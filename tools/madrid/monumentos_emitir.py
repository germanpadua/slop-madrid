#!/usr/bin/env python3
"""Emite los módulos js/monumentos/m-<id>.js y el manifest tools/madrid/monumentos.json.

Formato de módulo (contrato de tests/monumentos.test.cjs):
  export const MONUMENT = { id, vertices, triangles, quantum, indexBits, bounds, origin,
                            height, bytes, positions|colors|indices (base64) }
  positions: int16 decímetros relativos a origin (x este / y arriba / z sur), base y=0
  colors:    uint8 RGB intercalado por vértice

Fuentes:
  alcala, banco            -> módulos existentes (sin tocar)
  cibeles                  -> bacín real del servicio dedicado (sin el bloque central fotogramétrico)
                              + escultura low-poly procedural (peñasco, carro, Cibeles, leones)
  palacio, almudena        -> MODELADO_3D_MADRID (CITY) por separado, clip por bbox
  metropolis, atocha       -> MODELADO_3D_MADRID (CITY)
  neptuno, debod, plazaespana -> low-poly procedural (silueta icónica, ~2-8 KB)
"""
import sys, os, json, base64, hashlib
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
import monumentos_extract as M
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
JS_DIR = os.path.join(ROOT, 'js', 'monumentos')
MANIFEST = os.path.join(ROOT, 'tools', 'madrid', 'madrid-monumentos.json')
OUT_MANIFEST = os.path.join(ROOT, 'tools', 'madrid', 'monumentos.json')
Q = 0.1  # decímetros

PIEDRA = np.array([214, 202, 176], float)
PIEDRA_OSCURA = np.array([178, 166, 142], float)
MARMOL = np.array([228, 222, 206], float)
BRONCE = np.array([122, 96, 70], float)
TEJA = np.array([196, 140, 96], float)


# ---------------------------------------------------------------- utilidades

def utm_to_world(lon, lat):
    e, n = M.utm_vec(np.array([lon]), np.array([lat]))
    return float(e[0] - M.SOL_UTM[0]), float(-(n[0] - M.SOL_UTM[1]))


def soup_to_module(soup, colors_corner, budget):
    """soup (n*3,3) con colores por esquina -> (verts, faces, col) indexado y cuantizado a dm."""
    dm = np.round(soup / Q) * Q
    verts, faces, cell = M.decimate(dm, budget)
    # re-cuantizar los verts del decimate a dm y deduplicar
    key = np.round(verts / Q).astype(np.int64)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    vq = uniq.astype(np.float64) * Q
    faces = inv[faces]
    keep = (faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])
    faces = faces[keep]
    # color por vértice: el del primer corner que lo usa (paint y low-poly dan color por corner)
    if colors_corner is not None:
        colcorner = colors_corner.reshape(-1, 3)
    else:
        colcorner = M.paint(vq, faces).reshape(-1, 3)
    col = np.zeros((len(uniq), 3), np.uint8)
    seen = np.zeros(len(uniq), bool)
    for k, vi in enumerate(faces.reshape(-1)):
        if not seen[vi]:
            col[vi] = colcorner[k]
            seen[vi] = True
    return vq, faces.astype(np.uint32), col


def write_module(mid, vq, faces, col, origin, height, extra=None):
    os.makedirs(JS_DIR, exist_ok=True)
    rel = vq - np.array([origin[0], vq[:, 1].min(), origin[2]])
    pos_i16 = np.round(rel / Q).astype('<i2')
    indexBits = 16 if len(vq) <= 65535 else 32
    idx = faces.astype('<u4' if indexBits == 32 else '<u2')
    meta = {
        'id': mid,
        'vertices': int(len(vq)),
        'triangles': int(len(faces)),
        'quantum': Q,
        'indexBits': indexBits,
        'origin': [round(origin[0], 3), 0.0, round(origin[2], 3)],
        'bounds': [round(float(vq[:, 0].min()), 3), round(float(vq[:, 2].min()), 3),
                   round(float(vq[:, 0].max()), 3), round(float(vq[:, 2].max()), 3)],
        'height': round(height, 1),
    }
    if extra:
        meta.update(extra)
    meta = dict(meta)
    meta['positions'] = base64.b64encode(pos_i16.tobytes()).decode()
    meta['colors'] = base64.b64encode(col.astype(np.uint8).tobytes()).decode()
    meta['indices'] = base64.b64encode(idx.tobytes()).decode()
    meta['bytes'] = 0
    js = (
        f"// js/monumentos/m-{mid}.js — generado por tools/madrid/monumentos_emitir.py; no editar a mano.\n"
        f"export const MONUMENT = {json.dumps(meta, ensure_ascii=False)};\n"
    )
    path = os.path.join(JS_DIR, f'm-{mid}.js')
    with open(path, 'w') as f:
        f.write(js)
    size = os.path.getsize(path)
    return {
        'id': mid, 'module': f'js/monumentos/m-{mid}.js', 'bytes': size, 'tile': 'fase2',
        'md5': hashlib.md5(open(path, 'rb').read()).hexdigest(),
        **{k: v for k, v in meta.items() if k != 'bytes'},
        'bytes': size,
    }


# ---------------------------------------------------------------- low-poly

def box(cx, cy, cz, sx, sy, sz, col, yaw=0.0):
    """Caja centrada en (cx,cy,cz) con dimensiones (sx,sy,sz), giro yaw alrededor de y."""
    x, y, z = sx / 2, sy / 2, sz / 2
    v = np.array([
        [-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z],
        [-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z]], float)
    if yaw:
        c, s = np.cos(yaw), np.sin(yaw)
        v[:, 2], v[:, 0] = v[:, 2] * c - v[:, 0] * s, v[:, 0] * c + v[:, 2] * s
    v = v + [cx, cy, cz]
    f = np.array([
        [0, 2, 1], [0, 3, 2],       # suelo
        [4, 5, 6], [4, 6, 7],       # techo
        [0, 1, 5], [0, 5, 4],       # -z
        [2, 3, 7], [2, 7, 6],       # +z
        [1, 2, 6], [1, 6, 5],       # +x
        [3, 0, 4], [3, 4, 7]], int)  # -x
    return v, f, np.repeat(np.array(col, float)[None], 8, 0)


def cylinder(cx, cy, cz, r0, r1, h, seg, col):
    """Tronco de cono vertical (cilindro si r0==r1). Tapas incluidas."""
    ang = np.linspace(0, 2 * np.pi, seg, endpoint=False)
    lo = np.stack([r0 * np.cos(ang), np.zeros(seg), r0 * np.sin(ang)], 1) + [cx, cy, cz]
    hi = np.stack([r1 * np.cos(ang), np.zeros(seg), r1 * np.sin(ang)], 1) + [cx, cy + h, cz]
    v = np.concatenate([lo, hi])
    f = []
    for i in range(seg):
        j = (i + 1) % seg
        f += [[i, j, seg + j], [i, seg + j, seg + i],
              [i + seg, j + seg, 0 if False else i], ]  # (no se usa)
    f = []
    for i in range(seg):
        j = (i + 1) % seg
        f += [[i, j, seg + j], [i, seg + j, seg + i]]
    f += [[i, 2 * seg, (i + 1) % seg] for i in range(seg)]                      # tapa abajo
    f += [[seg + i, 2 * seg + 1, seg + (i + 1) % seg] for i in range(seg)]       # tapa arriba
    f = np.array(f, int)
    v = np.concatenate([v, [[cx, cy, cz], [cx, cy + h, cz]]])
    colv = np.repeat(np.array(col, float)[None], len(v), 0)
    return v, f, colv


def merge(*pieces):
    vs, fs, cs = [], [], []
    for v, f, c in pieces:
        vs.append(v)
        fs.append(f + sum(len(x) for x in vs[:-1]))
        cs.append(c)
    return np.concatenate(vs), np.concatenate(fs), np.concatenate(cs)


def lowpoly_cibeles(cx, cz, base_y):
    """Escultura: peñasco escalonado + carro + Cibeles + dos leones (mirando al NE, hacia Alcalá)."""
    yaw = np.radians(25)
    p = []
    p.append(cylinder(cx, base_y, cz, 3.6, 3.0, 1.4, 24, PIEDRA_OSCURA))
    p.append(cylinder(cx, base_y + 1.4, cz, 2.6, 2.0, 1.6, 20, PIEDRA))
    p.append(box(cx, base_y + 3.6, cz, 4.2, 0.9, 3.2, PIEDRA, yaw))            # carro plataforma
    p.append(box(cx, base_y + 4.6, cz - 0.4, 1.9, 2.1, 1.7, MARMOL, yaw))      # Cibeles
    p.append(box(cx + 1.9, base_y + 4.5, cz + 1.1, 2.6, 1.3, 1.1, MARMOL, yaw))   # león izq
    p.append(box(cx - 1.9, base_y + 4.5, cz + 1.1, 2.6, 1.3, 1.1, MARMOL, yaw))   # león der
    p.append(box(cx, base_y + 5.9, cz, 0.9, 0.5, 0.9, BRONCE, yaw))            # remate
    return merge(*p)


def lowpoly_neptuno(cx, cz, base_y):
    """Fuente de Neptuno: bacín ovalado sobre pedestal, peñasco y figura central."""
    yaw = np.radians(38)
    p = []
    n = 36
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    a, b = 4.6, 2.6
    rim = np.stack([a * np.cos(t), np.zeros(n), b * np.sin(t)], 1)
    inner = np.stack([a * 0.82 * np.cos(t), np.zeros(n), b * 0.82 * np.sin(t)], 1)
    lo = rim + [cx, base_y + 1.1, cz]
    hi = rim + [cx, base_y + 1.7, cz]
    inn = inner + [cx, base_y + 1.35, cz]
    v = np.concatenate([lo, hi, inn])
    f = []
    for i in range(n):
        j = (i + 1) % n
        f += [[i, j, n + j], [i, n + j, n + i], [n + i, n + j, 2 * n + i], [n + j, 2 * n + j, 2 * n + i]]
    f += [[i, 3 * n, (i + 1) % n] for i in range(n)]
    f = np.array(f, int)
    v = np.concatenate([v, [[cx, base_y, cz]]])
    col = np.repeat(PIEDRA[None], len(v), 0)
    p.append((v, np.array(f, int), col))
    p.append(cylinder(cx, base_y, cz, 1.5, 1.3, 1.1, 16, PIEDRA_OSCURA))       # pedestal
    p.append(cylinder(cx, base_y + 1.1, cz, 1.9, 1.2, 1.6, 18, PIEDRA))        # peñasco
    p.append(box(cx, base_y + 3.5, cz, 1.5, 2.0, 1.2, MARMOL, yaw))            # Neptuno
    p.append(box(cx + 0.6, base_y + 4.9, cz, 0.25, 1.1, 0.25, BRONCE, yaw))    # tridente
    return merge(*p)


def lowpoly_debod(cx, cz, base_y):
    """Templo de Debod: plataforma, caja del templo, pórtico con columnas y techo losa."""
    yaw = np.radians(12)  # orientación real: eje este-oeste aprox
    p = [box(cx, base_y + 0.4, cz, 26, 0.8, 20, PIEDRA_OSCURA, yaw)]
    ox, oz = np.cos(yaw), np.sin(yaw)
    p.append(box(cx, base_y + 4.6, cz, 14, 7.6, 10.5, PIEDRA, yaw))            # templo
    px, pz = cx - ox * 8.6, cz - oz * 8.6                                      # pórtico delantero
    for s in (-3.6, -1.2, 1.2, 3.6):
        p.append(cylinder(px + ox * s, base_y + 0.8, pz + oz * s, 0.45, 0.42, 5.4, 8, PIEDRA))
    p.append(box(px, base_y + 6.4, pz, 10.4, 0.9, 9.2, PIEDRA_OSCURA, yaw))
    px2, pz2 = cx + ox * 8.4, cz + oz * 8.4
    p.append(box(px2, base_y + 3.4, pz2, 10.4, 5.4, 1.0, PIEDRA_OSCURA, yaw))  # muro trasero
    return merge(*p)


def lowpoly_cervantes(cx, cz, base_y):
    """Monumento a Cervantes: base escalonada, obelisco central, dos pilares, figuras."""
    yaw = np.radians(-14)
    p = []
    p.append(box(cx, base_y + 0.5, cz, 20, 1.0, 12, PIEDRA_OSCURA, yaw))
    p.append(box(cx, base_y + 1.4, cz, 16, 0.8, 9.5, PIEDRA, yaw))
    ox, oz = np.cos(yaw), np.sin(yaw)
    for s in (-1, 1):
        p.append(box(cx + ox * 6.2 * s, base_y + 7.4, cz + oz * 6.2 * s, 2.6, 11.0, 2.6, PIEDRA, yaw))
    p.append(box(cx, base_y + 8.2, cz, 3.4, 14.0, 3.4, PIEDRA, yaw))           # obelisco
    p.append(box(cx, base_y + 15.6, cz, 4.2, 1.0, 4.2, PIEDRA_OSCURA, yaw))    # capitel
    p.append(box(cx, base_y + 2.9, cz - oz * 0.2 + 2.2, 1.4, 2.2, 1.2, MARMOL, yaw))   # Cervantes sentado
    p.append(box(cx + ox * 1.9, base_y + 2.7, cz + oz * 1.9 - 0.6, 0.9, 1.9, 0.9, BRONCE, yaw))  # Quijote
    p.append(box(cx - ox * 2.2, base_y + 2.6, cz + oz * 2.2 + 0.6, 0.9, 1.7, 0.9, BRONCE, yaw))  # Sancho
    return merge(*p)


# ---------------------------------------------------------------- mallas reales

def city_soup(mid, bx):
    nodes = M.select_nodes(bx)
    import concurrent.futures as cf
    with cf.ThreadPoolExecutor(4) as ex:
        geoms = list(ex.map(M.fetch_geom, nodes))
    tris = [t for t in (M.decode(n, p, bx) for n, p in geoms) if t is not None]
    soup = np.concatenate(tris).reshape(-1, 3)
    # el scrape municipal arrastra ruido aéreo (hasta 7 km de altura): corta por encima de +120 m del suelo
    ground = np.percentile(soup[:, 1], 5)
    soup = soup[soup[:, 1] < ground + 120]
    return soup


def cibeles_basin():
    svc = 'Conjunto_Fuente_Cibeles_sin_textura'
    base = f'https://tiles-eu1.arcgis.com/UrtTdLP2PYSxwtI6/arcgis/rest/services/{svc}/SceneServer/layers/0'
    import struct
    root = M.http(f'{base}/nodes/root')
    parts = []
    for n in root.get('children', []):
        cid = n['id']
        p = f'/tmp/sonda2-{svc}-{cid}.bin'
        raw = open(p, 'rb').read() if os.path.exists(p) else M.http(f'{base}/nodes/{cid}/geometries/0', binary=True)
        if not os.path.exists(p):
            open(p, 'wb').write(raw)
        nv, nf = struct.unpack('<II', raw[:8])
        v = np.frombuffer(raw, dtype='<f4', count=nv * 3, offset=8).reshape(-1, 3).copy()
        e, nn = M.utm_vec(v[:, 0] + n['mbs'][0], v[:, 1] + n['mbs'][1])
        parts.append(np.stack([e - M.SOL_UTM[0], v[:, 2] + n['mbs'][2], -(nn - M.SOL_UTM[1])], 1))
    soup = np.concatenate(parts).reshape(-1, 3, 3)
    # quitar el bloque central fotogramétrico (amasijo): lo sustituye la escultura low-poly
    keep = ~((soup[:, :, 0] > 904.0) & (soup[:, :, 0] < 917.0) & (soup[:, :, 2] > -286.5)
             & (soup[:, :, 2] < -269.5) & (soup[:, :, 1] > 645.4))
    soup = soup[keep.any(1)].reshape(-1, 3)
    v, f, c = soup_to_module(soup, None, 250000)
    return v, f, c


def main():
    import time
    t0 = time.time()
    entries = []
    # --- módulos existentes intactos
    old = json.load(open(OUT_MANIFEST))
    for meta in old['monuments']:
        if meta['id'] in ('alcala', 'banco'):
            path = os.path.join(ROOT, meta['module'])
            entries.append({**meta, 'bytes': os.path.getsize(path),
                            'md5': hashlib.md5(open(path, 'rb').read()).hexdigest()})

    # --- cibeles: bacín real + escultura
    v, f, c = cibeles_basin()
    bx, bz = 910.17, -277.0
    bv, bf, bc = lowpoly_cibeles(bx, bz, v[:, 1].min() + 1.15)
    fv = np.concatenate([v, bv]); ff = np.concatenate([f, bf + len(v)]); fc = np.concatenate([c, bc])
    y0 = fv[:, 1].min()
    meta = write_module('cibeles', fv, ff, fc, (float(fv[:, 0].min()), 0, float(fv[:, 2].min())),
                        float(fv[:, 1].max() - y0),
                        extra={'service': 'Conjunto_Fuente_Cibeles_sin_textura + escultura low-poly', 'cell': 0.35})
    entries.append(meta)
    print('cibeles', meta['vertices'], meta['triangles'], meta['bytes'])

    # --- CITY: palacio, almudena, metropolis, atocha
    CITY = {
        'palacio':   ((-1000.0, -800.0, -282.0, -22.0), 'Palacio Real (sin Almudena)'),
        'almudena':  ((-991.3, -826.4, 42.2, 178.9), 'Catedral de la Almudena'),
        'metropolis': ((645.0, 715.0, -218.0, -148.0), 'Edificio Metrópolis'),
        'atocha':    ((1027.0, 1438.0, 1122.0, 1610.0), 'Estación de Atocha (cubierta de vías)'),
    }
    for mid, (bbox, label) in CITY.items():
        soup = city_soup(mid, bbox)
        v, f, c = soup_to_module(soup, None, 250000)
        y0 = v[:, 1].min()
        meta = write_module(mid, v, f, c, (float(v[:, 0].min()), 0, float(v[:, 2].min())),
                            float(v[:, 1].max() - y0),
                            extra={'service': 'MODELADO_3D_MADRID', 'cell': 0.35, 'label': label})
        entries.append(meta)
        print(mid, meta['vertices'], meta['triangles'], meta['bytes'])

    # --- low-poly puros
    nx, nz = utm_to_world(-3.69317, 40.41528)
    dx, dz = -1153.9, -819.3     # anchor Templo de Debod
    cxx, czz = utm_to_world(-3.71144, 40.42327)   # monumento a Cervantes
    LOW = {
        'neptuno':     (lowpoly_neptuno(nx, nz, 0.0), 'Fuente de Neptuno', 'low-poly (sin malla municipal)'),
        'debod':       (lowpoly_debod(dx, dz, 0.0), 'Templo de Debod', 'low-poly (SceneServer municipal vacío)'),
        'plazaespana': (lowpoly_cervantes(cxx, czz, 0.0), 'Monumento a Cervantes (Plaza de España)', 'low-poly (sin malla municipal)'),
    }
    for mid, ((v, f, c), label, why) in LOW.items():
        v = v.copy()
        v[:, 1] -= v[:, 1].min()
        meta = write_module(mid, v, f, c, (float(v[:, 0].min()), 0, float(v[:, 2].min())),
                            float(v[:, 1].max()),
                            extra={'service': 'modelado manual', 'label': label, 'note': why})
        entries.append(meta)
        print(mid, meta['vertices'], meta['triangles'], meta['bytes'])

    total = sum(e['bytes'] for e in entries)
    manifest = {
        'monuments': entries,
        'totals': {'monuments': len(entries), 'bytes': total,
                   'triangles': sum(e['triangles'] for e in entries)},
        'missing': [],
        'notes': ('Escultura de Cibeles, Neptuno, Debod y Cervantes low-poly: los SceneServer municipales '
                  'dedicados a esas piezas no contienen malla utilizable (vacíos o fotogrametría sin silueta). '
                  'La fachada histórica de Atocha no está en el LOD2 municipal; el módulo lleva la cubierta de vías real.'),
    }
    with open(OUT_MANIFEST, 'w') as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
    if os.path.exists(MANIFEST):
        os.remove(MANIFEST)
    print('TOTAL', len(entries), 'monumentos', total, 'bytes', f'{time.time()-t0:.0f}s')


if __name__ == '__main__':
    main()
