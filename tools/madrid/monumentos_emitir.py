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
  neptuno, debod, plazaespana -> geometría procedural interpretativa, no dato municipal
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
    return v, f[:, ::-1], np.repeat(np.array(col, float)[None], 8, 0)


def cylinder(cx, cy, cz, r0, r1, h, seg, col):
    """Tronco de cono vertical (cilindro si r0==r1). Tapas incluidas."""
    ang = np.linspace(0, 2 * np.pi, seg, endpoint=False)
    lo = np.stack([r0 * np.cos(ang), np.zeros(seg), r0 * np.sin(ang)], 1) + [cx, cy, cz]
    hi = np.stack([r1 * np.cos(ang), np.zeros(seg), r1 * np.sin(ang)], 1) + [cx, cy + h, cz]
    v = np.concatenate([lo, hi])
    f = []
    for i in range(seg):
        j = (i + 1) % seg
        f += [[i, seg + j, j], [i, seg + i, seg + j]]
    f += [[i, (i + 1) % seg, 2 * seg] for i in range(seg)]
    f += [[seg + i, 2 * seg + 1, seg + (i + 1) % seg] for i in range(seg)]
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


def transform(piece, cx=0, cy=0, cz=0, yaw=0):
    """Giro local: +z es el frente; x este / z sur en coordenadas del visor."""
    v, f, c = piece
    co, si = np.cos(yaw), np.sin(yaw)
    rot = np.array([[co, 0, si], [0, 1, 0], [-si, 0, co]])
    return v @ rot.T + [cx, cy, cz], f, c


def ellipsoid(x, y, z, rx, ry, rz, col=MARMOL, seg=12, rings=6):
    """Volumen cerrado con polos únicos; facetas en vez de bloques para las tallas."""
    v = [[x, y - ry, z]]
    for j in range(1, rings):
        lat = -np.pi / 2 + np.pi * j / rings
        for i in range(seg):
            t = 2 * np.pi * i / seg
            v.append([x + rx * np.cos(lat) * np.cos(t), y + ry * np.sin(lat),
                      z + rz * np.cos(lat) * np.sin(t)])
    v.append([x, y + ry, z])
    f = []
    for i in range(seg):
        f.append([0, 1 + i, 1 + (i + 1) % seg])
    for j in range(rings - 2):
        for i in range(seg):
            a, b = 1 + j * seg + i, 1 + j * seg + (i + 1) % seg
            f.extend([[a, a + seg, b], [b, a + seg, b + seg]])
    for i in range(seg):
        f.append([len(v) - 1, 1 + (rings - 2) * seg + (i + 1) % seg,
                  1 + (rings - 2) * seg + i])
    return np.array(v), np.array(f), np.tile(col, (len(v), 1))


def rod(a, b, r, col=MARMOL, r1=None, seg=10):
    """Tubo/tronco de cono entre dos puntos: brazos, patas, radios y atributos."""
    a, b = np.array(a, float), np.array(b, float)
    axis = b - a
    length = np.linalg.norm(axis)
    axis /= length
    u = np.cross(axis, [0, 0, 1] if abs(axis[2]) < .9 else [1, 0, 0])
    u /= np.linalg.norm(u)
    w = np.cross(u, axis)
    v, f, c = cylinder(0, 0, 0, r, r if r1 is None else r1, length, seg, col)
    return v @ np.array([u, axis, w]) + a, f, c


def torus(x, y, z, major, minor, col, seg=24, sides=8, oval=1):
    v, f = [], []
    for i in range(seg):
        t = 2 * np.pi * i / seg
        for j in range(sides):
            a = 2 * np.pi * j / sides
            r = major + minor * np.cos(a)
            v.append([x + r * np.cos(t), y + minor * np.sin(a), z + oval * r * np.sin(t)])
    for i in range(seg):
        for j in range(sides):
            a, b = i * sides + j, ((i + 1) % seg) * sides + j
            c, d = i * sides + (j + 1) % sides, ((i + 1) % seg) * sides + (j + 1) % sides
            f.extend([[a, c, b], [b, c, d]])
    return np.array(v), np.array(f), np.tile(col, (len(v), 1))


def rock(x, y, z, sx, sy, sz, seed=0):
    v, f, c = ellipsoid(x, y, z, sx, sy, sz, PIEDRA_OSCURA, seg=9, rings=4)
    rng = np.random.default_rng(seed)
    v += rng.uniform(-.18, .18, v.shape) * [sx, sy, sz]
    c *= rng.uniform(.92, 1.12, (len(v), 1))
    return v, f, c


def person(x, floor, z, height=2, col=MARMOL, seated=False, stout=1, pose='rest'):
    """Talla articulada: torso ovoide, cuello, cabeza, hombros, brazos y piernas."""
    p = []
    # Coordenadas de la figura de pie normalizada; el sentado conserva cabeza y torso grandes.
    hip = .43 if not seated else .25
    torso = .64 if not seated else .49
    shoulder = .76 if not seated else .63
    head = .91 if not seated else .80
    def at(q):
        return (x + q[0] * height, floor + q[1] * height, z + q[2] * height)
    def orb(q, radii):
        p.append(ellipsoid(*at(q), *(np.array(radii) * height), col, seg=10, rings=5))
    orb((0, torso, 0), (.18 * stout, .23, .12 * stout))
    orb((0, hip, 0), (.17 * stout, .12, .14))
    p.append(rod(at((0, shoulder, 0)), at((0, head, 0)), height * .065, col, seg=8))
    orb((0, head, .015), (.105, .13, .105))
    orb((0, head - .02, .10), (.045, .045, .045))  # nariz / perfil
    for side in (-1, 1):
        if seated:
            leg = [(side * .105, hip, 0), (side * .12, .22, .28), (side * .12, .035, .31)]
        else:
            leg = [(side * .095, hip, 0), (side * .11, .23, side * .025), (side * .12, .035, .04)]
        for a, b in zip(leg, leg[1:]):
            p.append(rod(at(a), at(b), height * .078 * stout, col, r1=height * .055, seg=8))
        orb((leg[-1][0], .04, leg[-1][2] + .035), (.075 * stout, .045, .12))
        start = (side * .15 * stout, shoulder, 0)
        if pose == 'extend' and side == 1:
            elbow, hand = (.36, .70, .04), (.57, .72, .04)
        elif pose == 'raise' and side == -1:
            elbow, hand = (-.32, .85, 0), (-.40, 1.04, 0)
        else:
            elbow, hand = (side * .24, shoulder - .16, .06), (side * .20, shoulder - .28, .20)
        p.append(rod(at(start), at(elbow), height * .062, col, r1=height * .05, seg=8))
        p.append(rod(at(elbow), at(hand), height * .05, col, r1=height * .04, seg=8))
        orb(hand, (.055, .065, .055))
    return merge(*p)


def wheel(x, y, z, radius):
    # Rueda en el plano yz: aro, cubo y ocho radios; huecos realmente abiertos.
    p = [transform(torus(0, 0, 0, radius, .14, MARMOL, seg=24, sides=6),
                   x, y, z)]
    # El torus horizontal gira 90° sobre z para que su eje sea x.
    v, f, c = p[0]
    v = (v - [x, y, z]) @ np.array([[0, 1, 0], [-1, 0, 0], [0, 0, 1]]) + [x, y, z]
    p[0] = v, f, c
    p.append(rod((x - .23, y, z), (x + .23, y, z), .25, MARMOL))
    for a in np.linspace(0, 2 * np.pi, 8, endpoint=False):
        p.append(rod((x, y, z), (x, y + radius * np.cos(a), z + radius * np.sin(a)), .10, PIEDRA))
    return merge(*p)


def lion(x, floor, z):
    p = [ellipsoid(x, floor + .9, z, .48, .56, 1.12),
         ellipsoid(x, floor + 1.25, z + .76, .53, .70, .55, PIEDRA),
         ellipsoid(x, floor + 1.58, z + 1.03, .35, .37, .39),
         ellipsoid(x, floor + 1.43, z + 1.36, .26, .19, .29)]
    for side in (-1, 1):
        p.append(ellipsoid(x + side * .27, floor + 1.87, z + .92, .13, .16, .13))
        for along in (-.66, .64):
            p.append(rod((x + side * .32, floor + .93, z + along),
                         (x + side * .36, floor + .18, z + along + .2), .19, r1=.14))
            p.append(ellipsoid(x + side * .36, floor + .14, z + along + .36, .22, .14, .31))
    for a, b in zip([(x, floor + 1, z - 1), (x + .55, floor + .65, z - 1.4),
                     (x + .65, floor + 1.15, z - 1.6)],
                    [(x + .55, floor + .65, z - 1.4), (x + .65, floor + 1.15, z - 1.6),
                     (x + .40, floor + 1.3, z - 1.6)]):
        p.append(rod(a, b, .10))
    return merge(*p)


def lowpoly_cibeles(cx, cz, base_y):
    """Dos leones al NE (vector hacia Alcalá), carro de ruedas caladas y diosa coronada."""
    p = [cylinder(0, 0, 0, 3.7, 3.5, .35, 28, PIEDRA_OSCURA)]
    for i, (x, y, z, sx, sy, sz) in enumerate([
            (0, .6, 0, 3.5, .7, 3.0), (-1.7, 1.05, -.6, 1.7, .8, 1.7),
            (1.5, 1.05, .6, 1.6, .8, 2.0), (0, 1.4, -1, 2.4, .8, 1.9),
            (-1.3, .8, 2.4, 1.4, .7, 1.6), (1.3, .8, 2.4, 1.4, .7, 1.6)]):
        p.append(rock(x, y, z, sx, sy, sz, i))
    p.extend([box(0, 2.0, -.8, 2.8, .45, 3.1, PIEDRA),
              box(0, 2.45, -1.7, 2.5, .6, 1.1, MARMOL),
              box(0, 3.25, -2, 1.9, 2.5, .42, PIEDRA)])
    for side in (-1, 1):
        for along in (-1.8, .15):
            p.append(wheel(side * 1.55, 1.9, along, .82))
        p.append(rod((side * 1.1, 2.3, -.8), (side * 1.5, 1.6, 2.3), .12, PIEDRA))
        p.append(lion(side * 1.25, 1.12, 2.25))
        # Costados curvos del carro, con volutas en los extremos.
        p.append(ellipsoid(side * 1.13, 2.7, -.65, .25, .55, 1.25, PIEDRA))
        p.append(transform(torus(0, 0, 0, .31, .12, MARMOL, seg=16, sides=6),
                           side * 1.2, 2.9, .4))
    p.append(person(0, 2.3, -1.2, 3.2, seated=True))
    p.append(cylinder(0, 4.95, -1.15, .35, .32, .30, 12, MARMOL))
    for t in np.linspace(0, 2 * np.pi, 6, endpoint=False):
        p.append(box(.28 * np.cos(t), 5.32, -1.15 + .28 * np.sin(t), .19, .35, .19, MARMOL))
    # Cetro, orbe y pliegues de la túnica, más anchos que un decímetro.
    p.append(rod((-.83, 3.5, -.65), (-.83, 5.15, -.65), .11, MARMOL))
    p.append(ellipsoid(.72, 3.75, -.60, .24, .24, .24))
    for x in np.linspace(-.42, .42, 5):
        p.append(rod((x, 3.4, -.65), (x * 1.25, 2.45, -.15), .12, PIEDRA))
    # +z local apunta al vector Alcalá - Cibeles: (+370, -70), nunca al SO.
    return transform(merge(*p), cx, base_y, cz, np.arctan2(370, -70))


def lowpoly_neptuno(cx, cz, base_y):
    """Bacín oval, doble bocel, concha, volutas, dios y tridente de tres púas separadas."""
    water = np.array([65, 104, 109])
    p = [transform(cylinder(0, 0, 0, 6.6, 6.6, .38, 48, PIEDRA_OSCURA))]
    v, f, c = p[0]; v[:, 2] *= .76; p[0] = v, f, c
    p.append(ellipsoid(0, .40, 0, 6.15, .12, 4.55, water, seg=48, rings=4))
    for y, r, minor in ((.5, 6.35, .25), (.90, 6.45, .22)):
        p.append(torus(0, y, 0, r, minor, PIEDRA, seg=48, sides=8, oval=.76))
    for i, x in enumerate((-1.65, 0, 1.7)):
        p.append(rock(x, 1.0, 0, 1.8, .85, 1.6, 20 + i))
    p.extend([cylinder(0, 1.25, 0, 1.9, 1.5, .85, 24, PIEDRA),
              ellipsoid(0, 2.1, -.15, 1.65, .28, 1.25, MARMOL)])
    # Concha abierta detrás: nervaduras radiantes en abanico, sin tapar la figura.
    for t in np.linspace(-1.15, 1.15, 11):
        p.append(rod((0, 1.8, -.3), (1.55 * np.sin(t), 2.55 + .5 * np.cos(t), -1.0), .14, PIEDRA))
    for side in (-1, 1):
        scroll = torus(0, 0, 0, .48, .17, MARMOL, seg=20, sides=6)
        v, f, c = scroll
        v = v[:, [0, 2, 1]]  # voluta en plano vertical xy
        p.append((v + [side * 1.7, 1.85, .1], f[:, ::-1], c))
        # Delfines: lomo arqueado, hocico, aletas y cola bifurcada.
        p.extend([ellipsoid(side * 2.45, 1.2, .55, .42, .58, .95, MARMOL),
                  ellipsoid(side * 2.45, 1.15, 1.28, .26, .26, .40, MARMOL),
                  rod((side * 2.45, 1.1, 1.4), (side * 2.45, .92, 1.9), .16, r1=.10),
                  rod((side * 2.45, 1.25, -.1), (side * 2.45, 1.8, -.8), .22, r1=.12)])
        for branch in (-1, 1):
            p.append(rod((side * 2.45, 1.8, -.8), (side * 2.45 + branch * .40, 1.95, -.95), .14))
    p.append(person(0, 2.25, 0, 3.8, pose='extend'))
    p.append(ellipsoid(0, 5.52, .18, .30, .32, .22, PIEDRA))  # barba
    # Paño a la cadera, piernas y torso conservan una silueta humana.
    p.append(ellipsoid(0, 3.85, 0, .70, .40, .49, PIEDRA))
    # Mano extendida a la derecha, unida al asta: 0.57 * 3.8 = 2.17 m.
    tx, tz = 2.15, .15
    p.append(rod((tx, 2.1, tz), (tx, 7.2, tz), .12, BRONCE, seg=10))
    p.append(rod((tx - .70, 6.5, tz), (tx + .70, 6.5, tz), .13, BRONCE))
    for off in (-.70, 0, .70):
        top = 7.5 if off == 0 else 7.25
        p.append(rod((tx + off, 6.5, tz), (tx + off, top - .25, tz), .13, BRONCE))
        p.append(rod((tx + off, top - .25, tz), (tx + off, top, tz), .18, BRONCE, r1=.02))
    return transform(merge(*p), cx, base_y, cz, np.radians(-18))


def gable(x, y, z, width, depth, rise, col):
    v = np.array([[-width / 2, 0, -depth / 2], [width / 2, 0, -depth / 2],
                  [0, rise, -depth / 2], [-width / 2, 0, depth / 2],
                  [width / 2, 0, depth / 2], [0, rise, depth / 2]]) + [x, y, z]
    f = np.array([[0, 1, 2], [3, 5, 4], [0, 2, 5], [0, 5, 3],
                  [2, 1, 4], [2, 4, 5], [0, 3, 4], [0, 4, 1]])[:, ::-1]
    return v, f, np.tile(col, (len(v), 1))


def lowpoly_debod(cx, cz, base_y):
    """Templo de piedra, cubierta con pico bajo, columnas, dos puertas axiales y estanque."""
    sand = np.array([193, 160, 113])
    light = np.array([218, 187, 140])
    dark = np.array([115, 96, 73])
    p = [box(0, .2, 6, 31, .4, 44, PIEDRA_OSCURA),
         box(0, .6, -3, 27, .4, 25, PIEDRA),
         box(0, 1.0, -4, 24, .4, 20, sand),
         box(0, .48, 16, 23, .16, 20, [45, 67, 67])]
    # Bordes del vaso por encima de la lámina hundida.
    for x in (-11.8, 11.8):
        p.append(box(x, .70, 16, .5, .40, 20.5, sand))
    p.append(box(0, .70, 26.1, 24, .4, .5, sand))
    p.append(box(0, .75, 15, 4.4, .5, 23, sand))  # camino sagrado axial
    # Caja de la capilla hecha por hiladas, juntas y hueco real de entrada.
    for row in range(7):
        y = 1.2 + .70 * row
        for x in (-5.8, 5.8):
            for z in np.arange(-10.3, -.6, 1.6):
                p.append(box(x, y + .33, z, 1.05, .66, 1.55,
                             light if (row + int(z)) % 3 else sand))
        for x in np.arange(-5.0, 5.1, 1.4):
            p.append(box(x, y + .33, -11.0, 1.35, .66, 1.0, sand))
            if abs(x) > 1.6 or row >= 5:
                p.append(box(x, y + .33, -.1, 1.35, .66, 1.0, light))
    p.append(box(0, 6.2, -5.5, 13.2, .5, 12.2, sand))
    # Pico bajo solicitado, del color de la piedra (sin frontón clásico ni tejas).
    p.append(gable(0, 6.45, -5.5, 13.2, 12.2, .8, light))
    p.append(box(0, 3.0, -.55, 2.5, 3.6, .16, dark))  # sombra interior del portal
    for x in (-4.5, -1.5, 1.5, 4.5):
        p.append(cylinder(x, 1.2, 2.2, .72, .48, 4.5, 16, light))
        p.append(cylinder(x, 1.2, 2.2, .88, .86, .32, 16, sand))
        p.append(cylinder(x, 5.4, 2.2, .48, .85, .45, 16, sand))
    p.extend([box(0, 6.0, 2.2, 12.6, .6, 2.1, sand),
              box(0, 6.4, 2.2, 13.2, .25, 2.5, light)])
    # Segundo pórtico trasero, también calado y con columnas cónicas.
    for x in (-4.2, 0, 4.2):
        p.append(cylinder(x, 1.2, -12.5, .68, .45, 4.4, 16, light))
    p.append(box(0, 5.8, -12.5, 11.2, .7, 1.8, sand))
    # Dos pilonos exentos alineados delante del templo: silueta icónica de Debod.
    for z, h in ((10.3, 5.4), (20.3, 4.6)):
        for side in (-1, 1):
            p.append(box(side * 2.8, .95 + h / 2, z, 1.3, h, 1.2, light))
            p.append(box(side * 2.8, 1.1, z, 1.65, .30, 1.6, sand))
        p.append(box(0, .95 + h, z, 7.1, .65, 1.5, sand))
        p.append(box(0, 1.35 + h, z, 7.5, .2, 1.8, light))
    # Recinto en L, abierto por el frente para ver templo y agua.
    for x in np.arange(-11.5, 12, 1.6):
        p.append(box(x, 1.9, -14.1, 1.55, 1.4, .75, sand))
    for z in np.arange(-13, 5, 1.6):
        p.append(box(-11.5, 1.9, z, .75, 1.4, 1.55, sand))
    return transform(merge(*p), cx, base_y, cz, np.radians(12))


def lowpoly_cervantes(cx, cz, base_y):
    """Sillería, estela escalonada, alas curvas y grupos de figuras con volumen."""
    p = []
    for i in range(5):
        p.append(box(0, .18 + i * .30, 0, 23 - i * 1.1, .36, 14 - i * .8,
                     PIEDRA_OSCURA if i == 0 else PIEDRA))
    # Sillería visible con juntas en el zócalo central.
    for row in range(3):
        for x in np.arange(-3.2, 3.3, 1.3):
            p.append(box(x, 1.6 + row * .55, 0, 1.25, .52, 5.6, PIEDRA))
    for y, width, depth, height in ((3.4, 6.6, 5, 1), (6.8, 5.6, 4.4, 5.8),
                                    (10.3, 6.3, 4.8, 1.1), (14.9, 4.3, 3.8, 8.1),
                                    (19.4, 5.3, 4.6, .9), (20.2, 4.7, 4.0, .7)):
        p.append(box(0, y, 0, width, height, depth, PIEDRA))
    # Nervios y relieves dan profundidad a la estela de varios cuerpos.
    for side in (-1, 1):
        p.append(box(side * 1.88, 14.8, 2, .36, 7.7, .35, MARMOL))
        p.append(person(side * 1.25, 11.5, 2.13, 2.2, PIEDRA))
    # Continentes alrededor del globo, remate reconocible, sin aguja inventada.
    for a in np.linspace(0, 2 * np.pi, 5, endpoint=False):
        p.append(person(1.15 * np.cos(a), 20.5, .95 * np.sin(a), 1.9, MARMOL, seated=True))
    p.append(ellipsoid(0, 22.25, 0, 1.15, 1.15, 1.15, PIEDRA, seg=20, rings=8))
    # Dos brazos bajos curvos, continuos; los grupos quedan separados de la estela.
    for side in (-1, 1):
        for i in range(10):
            t = i / 9
            x, z = side * (3.3 + 5.1 * t), .4 + 2.6 * t * t
            yaw = -side * np.arctan(5.2 * t / 5.1)
            p.append(box(x, 2.2, z, .86, 1.65, 1.8, PIEDRA, yaw))
            p.append(box(x, 3.1, z, .88, .22, 2.1, MARMOL, yaw))
        p.append(cylinder(side * 8.6, 1.6, 3.1, 1.65, 1.5, 1.9, 20, PIEDRA))
        p.append(person(side * 8.6, 3.5, 3.1, 3.0, MARMOL, seated=True))
        p.append(person(side * 6.8, 3.25, 1.7, 1.9, PIEDRA, pose='raise'))
        p.append(person(side * 9.3, 3.5, 2.5, 1.6, MARMOL))
    # Cervantes sentado, libro y gola; Quijote delgado con lanza, Sancho más ancho.
    p.extend([box(0, 4.3, 3, 2.0, 3.6, .7, PIEDRA_OSCURA),
              box(0, 3.2, 3.5, 2.0, .45, 1.6, PIEDRA),
              person(0, 2.9, 3.75, 3.4, MARMOL, seated=True),
              box(.45, 4.35, 4.5, .65, .2, .75, PIEDRA_OSCURA, .15),
              person(-2.2, 1.6, 4.5, 3.4, BRONCE, pose='raise'),
              person(2.0, 1.6, 4.6, 2.65, BRONCE, stout=1.45)])
    p.append(cylinder(2, 3.95, 4.6, .46, .32, .22, 16, BRONCE))  # sombrero Sancho
    p.append(cylinder(-2.2, 4.85, 4.5, .34, .25, .22, 12, BRONCE))
    p.append(rod((-3.6, 1.7, 4.65), (-3.6, 7.5, 4.65), .11, BRONCE))
    p.append(ellipsoid(-2.9, 3.15, 4.85, .48, .65, .18, BRONCE))  # escudo
    p.append(torus(0, 5.37, 3.75, .32, .12, MARMOL, seg=16, sides=6))
    return transform(merge(*p), cx, base_y, cz, np.radians(-14))


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


def read_module(mid):
    """Lee el JSON del módulo, sin ejecutar JS ni acceder al servicio municipal."""
    path = os.path.join(JS_DIR, f'm-{mid}.js')
    text = open(path).read()
    data = json.loads(text.split('export const MONUMENT = ', 1)[1].rstrip().rstrip(';'))
    v = np.frombuffer(base64.b64decode(data['positions']), '<i2').reshape(-1, 3).astype(float)
    v *= data['quantum']
    v += [data['origin'][0], 0, data['origin'][2]]
    f = np.frombuffer(base64.b64decode(data['indices']), '<u2' if data['indexBits'] == 16 else '<u4').reshape(-1, 3)
    c = np.frombuffer(base64.b64decode(data['colors']), 'u1').reshape(-1, 3)
    return data, v, f, c


def main():
    """Regenera SÓLO las cuatro piezas manuales; conserva las seis mallas municipales.

    Cibeles almacena el límite entre el bacín original y la talla para que sucesivas
    ejecuciones sean idempotentes. La primera migración comprueba la topología del
    bloque antiguo (132 vértices / 236 triángulos) antes de separar ese sufijo.
    """
    old = json.load(open(OUT_MANIFEST))
    data, v, f, c = read_module('cibeles')
    split = data.get('proceduralStart', {'vertices': 3371, 'triangles': 7791})
    nv, nf = split['vertices'], split['triangles']
    if 'proceduralStart' not in data:
        if len(v) != nv + 132 or len(f) != nf + 236:
            raise ValueError('Cibeles no coincide con el módulo original: no se toca el bacín')
    if np.any(f[:nf] >= nv) or np.any(f[nf:] < nv):
        raise ValueError('La escultura y el bacín deben tener índices independientes')
    v, f, c = v[:nv], f[:nf], c[:nv]
    bv, bf, bc = lowpoly_cibeles(910.17, -277.0, 1.15)
    pieces = {
        'cibeles': (merge((v, f, c), (bv, bf, bc)), {
            'service': 'Conjunto_Fuente_Cibeles_sin_textura + escultura procedural',
            'cell': .35, 'proceduralStart': split}),
        'neptuno': (lowpoly_neptuno(*utm_to_world(-3.69317, 40.41528), 0), {
            'service': 'modelado manual', 'label': 'Fuente de Neptuno',
            'note': 'Geometría procedural interpretativa; no es dato municipal'}),
        'debod': (lowpoly_debod(-1153.9, -819.3, 0), {
            'service': 'modelado manual', 'label': 'Templo de Debod',
            'note': 'Geometría procedural interpretativa; pico bajo y columnas según brief'}),
        'plazaespana': (lowpoly_cervantes(*utm_to_world(-3.71144, 40.42327), 0), {
            'service': 'modelado manual', 'label': 'Monumento a Cervantes (Plaza de España)',
            'note': 'Geometría procedural interpretativa; Quijote y Sancho de pie según brief'}),
    }
    entries = []
    for original in old['monuments']:
        mid = original['id']
        if mid not in pieces:
            entries.append(original)
            continue
        (v, f, c), extra = pieces[mid]
        # Cuantizar antes de calcular bounds/height: coinciden exactamente con el módulo.
        # El prefijo municipal de Cibeles ya está cuantizado y se conserva sin filtrar caras.
        v = np.round(v / Q) * Q
        start = split['triangles'] if mid == 'cibeles' else 0
        # La cuantización puede colapsar detalles subdecimétricos. Sólo se filtra
        # geometría procedural; ninguna cara municipal se modifica.
        procedural = f[start:]
        area = np.linalg.norm(np.cross(v[procedural[:, 1]] - v[procedural[:, 0]],
                                       v[procedural[:, 2]] - v[procedural[:, 0]]), axis=1)
        f = np.concatenate([f[:start], procedural[area > 1e-7]])
        origin = (float(v[:, 0].min()), 0, float(v[:, 2].min()))
        height = float(np.ptp(v[:, 1]))
        if not 0 < height <= 120:
            raise ValueError(f'{mid}: altura fuera de contrato')
        entry = write_module(mid, v, f, np.clip(c, 0, 255), origin, height, extra)
        if entry['bytes'] > 250 * 1024:
            raise ValueError(f'{mid}: módulo sobre presupuesto')
        entries.append(entry)
        print(mid, entry['vertices'], entry['triangles'], entry['bytes'])
    total = sum(e['bytes'] for e in entries)
    if total > 2 * 1024 * 1024:
        raise ValueError('El conjunto supera 2 MiB')
    manifest = {**old, 'monuments': entries,
                'totals': {'monuments': len(entries), 'bytes': total,
                           'triangles': sum(e['triangles'] for e in entries)}}
    with open(OUT_MANIFEST, 'w') as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    print('TOTAL', len(entries), 'monumentos', total, 'bytes')


if __name__ == '__main__':
    main()
