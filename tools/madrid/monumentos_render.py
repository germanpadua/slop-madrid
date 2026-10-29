#!/usr/bin/env python3
"""Render CPU de los módulos MONUMENT reales: int16 dm, RGB uint8, índices base64.

Uso (numpy + Pillow):
  ~/workspace/artifacts/tiny-madrid-north-r4/venv/bin/python tools/madrid/monumentos_render.py

Azimut 45°, elevación 30°, proyección ortográfica. Painter ordena las caras de
lejos a cerca; un z-buffer baricéntrico por píxel resuelve las intersecciones y
las caras horizontales que podrían ocultar la escultura. Se descartan caras
traseras igual que el material FrontSide del visor. No requiere Three ni red.
"""
import argparse
import base64
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
IDS = ('cibeles', 'neptuno', 'debod', 'plazaespana')


def load_module(mid, root=ROOT):
    text = (root / 'js' / 'monumentos' / f'm-{mid}.js').read_text()
    data = json.loads(text.split('export const MONUMENT = ', 1)[1].strip().removesuffix(';'))
    v = np.frombuffer(base64.b64decode(data['positions']), '<i2').reshape(-1, 3).astype(float)
    v *= data['quantum']
    # Los emisores usan bounds mínimos como origen; los originales conservan
    # también origin con más precisión. Respetamos origin como hace el loader.
    origin = data.get('origin', [data['bounds'][0], 0, data['bounds'][1]])
    v += [origin[0], 0, origin[2]]
    f = np.frombuffer(base64.b64decode(data['indices']), '<u2' if data['indexBits'] == 16 else '<u4').reshape(-1, 3)
    c = np.frombuffer(base64.b64decode(data['colors']), 'u1').reshape(-1, 3)
    return data, v, f, c


def render(v, f, c, width=1000, height=1000, az=45, el=30, fit=None):
    az, el = np.radians([az, el])
    eye = np.array([np.sin(az) * np.cos(el), np.sin(el), np.cos(az) * np.cos(el)])
    right = np.array([np.cos(az), 0, -np.sin(az)])
    up = np.cross(eye, right)
    basis = np.stack([right, up, eye], 1)
    centre = (v.min(0) + v.max(0)) / 2
    camera = (v - centre) @ basis
    frame = camera if fit is None else (fit - centre) @ basis
    lo, hi = frame[:, :2].min(0), frame[:, :2].max(0)
    scale = min((width - 110) / max(hi[0] - lo[0], .1), (height - 110) / max(hi[1] - lo[1], .1))
    screen = camera.copy()
    screen[:, 0] = (camera[:, 0] - (lo[0] + hi[0]) / 2) * scale + width / 2
    screen[:, 1] = height / 2 - (camera[:, 1] - (lo[1] + hi[1]) / 2) * scale
    rgb = np.full((height, width, 3), [233, 237, 239], dtype=np.uint8)
    zbuf = np.full((height, width), -np.inf)
    normals = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    lengths = np.linalg.norm(normals, axis=1)
    normals /= np.maximum(lengths[:, None], 1e-12)
    light = np.array([-0.4, .84, .36]); light /= np.linalg.norm(light)
    # Luz difusa y ambiente sin colores añadidos al modelo.
    intensity = .50 + .50 * np.maximum(0, normals @ light)
    for fi in np.argsort(camera[f, 2].mean(1)):
        if lengths[fi] < 1e-9 or normals[fi] @ eye <= 0:
            continue
        tri = screen[f[fi]]
        x0, y0 = np.maximum(np.floor(tri[:, :2].min(0)).astype(int), [0, 0])
        x1, y1 = np.minimum(np.ceil(tri[:, :2].max(0)).astype(int), [width - 1, height - 1])
        if x0 > x1 or y0 > y1:
            continue
        a, b, d = tri
        denom = (b[1] - d[1]) * (a[0] - d[0]) + (d[0] - b[0]) * (a[1] - d[1])
        if abs(denom) < 1e-9:
            continue
        xx, yy = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
        wa = ((b[1] - d[1]) * (xx - d[0]) + (d[0] - b[0]) * (yy - d[1])) / denom
        wb = ((d[1] - a[1]) * (xx - d[0]) + (a[0] - d[0]) * (yy - d[1])) / denom
        wd = 1 - wa - wb
        depth = wa * a[2] + wb * b[2] + wd * d[2]
        target = zbuf[y0:y1 + 1, x0:x1 + 1]
        keep = (wa >= -1e-6) & (wb >= -1e-6) & (wd >= -1e-6) & (depth > target)
        target[keep] = depth[keep]
        color = (wa[..., None] * c[f[fi, 0]] + wb[..., None] * c[f[fi, 1]] + wd[..., None] * c[f[fi, 2]]) * intensity[fi]
        rgb[y0:y1 + 1, x0:x1 + 1][keep] = np.clip(color[keep], 0, 255).astype(np.uint8)
    result = Image.fromarray(rgb)
    draw = ImageDraw.Draw(result)
    # Barra métrica para valorar el tamaño del detalle (nunca rebasa el panel).
    metres = 2 if scale > 50 else 5
    draw.line((35, height - 30, 35 + metres * scale, height - 30), fill='#4b555b', width=3)
    draw.text((35, height - 52), f'{metres} m', fill='#4b555b')
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('ids', nargs='*', default=list(IDS), choices=IDS)
    ap.add_argument('--out', type=Path, default=Path('/tmp/monumentos-codex'))
    ap.add_argument('--round', type=int, default=1)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for mid in args.ids:
        data, v, f, c = load_module(mid)
        full = render(v, f, c)
        if mid == 'cibeles':
            first = data['proceduralStart']['vertices']
            detail = render(v, f, c, fit=v[first:])
        elif mid == 'neptuno':
            detail = render(v, f, c, fit=v[v[:, 1] > 1.1])
        elif mid == 'plazaespana':
            detail = render(v, f, c, fit=v[(v[:, 1] < 8) & (v[:, 1] > 1)])
        else:
            detail = render(v, f, c, az=225)
        sheet = Image.new('RGB', (2000, 1050), '#f9fafb')
        sheet.paste(full, (0, 50)); sheet.paste(detail, (1000, 50))
        draw = ImageDraw.Draw(sheet)
        draw.text((30, 18), 'AZ 45 / EL 30 - conjunto', fill='#27343d')
        draw.text((1030, 18), 'AZ 225 / EL 30 - reverso' if mid == 'debod' else 'AZ 45 / EL 30 - detalle', fill='#27343d')
        sheet.save(args.out / f'{mid}-r{args.round}.png')
        sheet.save(args.out / f'{mid}.png')
        full.save(args.out / f'{mid}-iso.png')
        print(mid, data['triangles'], 'triangles', args.out / f'{mid}-r{args.round}.png')


if __name__ == '__main__':
    main()
