// Hole-aware slicer regression tests (js/madrid-footprint.js decomposeRing).
// Elementary cases locked after the 2026-10-28 intrusion bug: a hole floating inside one tall
// slab was missed by slab-edge scans (100% built over) and merge u-averaging pulled edges in.
const test = require('node:test');
const assert = require('node:assert');

const inPoly = (ring, x, z) => {
  let ins = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xj = ring[j], zj = ring[j + 1], xi = ring[i], zi = ring[i + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
};
const inRectW = (x, z, r) => {
  const c = r.corners;
  const e1x = c[1][0] - c[0][0], e1z = c[1][1] - c[0][1], e2x = c[3][0] - c[0][0], e2z = c[3][1] - c[0][1];
  const px = x - c[0][0], pz = z - c[0][1];
  const l1 = e1x * e1x + e1z * e1z, l2 = e2x * e2x + e2z * e2z;
  if (l1 < 1e-12 || l2 < 1e-12) return false;
  const t1 = (px * e1x + pz * e1z) / l1, t2 = (px * e2x + pz * e2z) / l2;
  return t1 >= -1e-9 && t1 <= 1 + 1e-9 && t2 >= -1e-9 && t2 <= 1 + 1e-9;
};
// Area-sampled intrusion: fraction of hole interior covered by any rect (0.05m-class grid).
const intrusion = (d, holes) => {
  let intr = 0, tot = 0;
  for (const h of holes) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < h.length; i += 2) { x0 = Math.min(x0, h[i]); x1 = Math.max(x1, h[i]); z0 = Math.min(z0, h[i + 1]); z1 = Math.max(z1, h[i + 1]); }
    const step = Math.max(0.05, Math.sqrt((x1 - x0) * (z1 - z0)) / 80);
    for (let gx = x0; gx < x1; gx += step) for (let gz = z0; gz < z1; gz += step) {
      if (!inPoly(h, gx + step / 2, gz + step / 2)) continue;
      tot++; if (d.rects.some((r) => inRectW(gx + step / 2, gz + step / 2, r))) intr++;
    }
  }
  return tot ? intr / tot : 0;
};

test('square with central patio: no rect mass inside the hole', async () => {
  const { decomposeRing } = await import('../js/madrid-footprint.js');
  const hole = [-3, -3, -3, 3, 3, 3, 3, -3];
  const d = decomposeRing([-10, -10, -10, 10, 10, 10, 10, -10], { stripW: 4, minD: 0.4, holes: [hole] });
  assert.ok(d.rects.length >= 4, 'frame surrounds the patio');
  assert.ok(intrusion(d, [hole]) < 0.005, 'intrusion < 0.5% of hole area');
  assert.ok(d.deviation < 0.12);
});

test('tiny hole floating inside one tall slab is subtracted (was 100% built over)', async () => {
  const { decomposeRing } = await import('../js/madrid-footprint.js');
  const hole = [13, 13, 13, 16, 16, 16, 16, 13];
  const d = decomposeRing([0, 0, 0, 30, 30, 30, 30, 0], { stripW: 6, minD: 0.4, holes: [hole] });
  assert.ok(d.rects.length >= 2);
  assert.ok(intrusion(d, [hole]) < 0.005);
});

test('plain rectangle with patio does not collapse to one solid box', async () => {
  const { decomposeRing } = await import('../js/madrid-footprint.js');
  const hole = [10, 7, 10, 13, 20, 13, 20, 7];
  const d = decomposeRing([0, 0, 0, 20, 30, 20, 30, 0], { stripW: 4, minD: 0.4, holes: [hole] });
  assert.ok(d.rects.length >= 2, 'patio keeps the ring from merging to a single box');
  assert.ok(intrusion(d, [hole]) < 0.005);
});

test('rotated square with rotated hole: sane frame, no intrusion', async () => {
  const { decomposeRing } = await import('../js/madrid-footprint.js');
  const rot = (a) => { const c = Math.cos(a), s = Math.sin(a); return ([x, z]) => [x * c - z * s, x * s + z * c]; };
  const flat = (ps) => ps.flat();
  const ext = [[-10, -10], [-10, 10], [10, 10], [10, -10]].map(rot(Math.PI / 6));
  const hole = [[-3, -3], [-3, 3], [3, 3], [3, -3]].map(rot(Math.PI / 6));
  const d = decomposeRing(flat(ext), { stripW: 4, minD: 0.4, holes: [flat(hole)] });
  assert.ok(Number.isFinite(d.frame.ux), 'obbFrame returns real axes');
  assert.ok(d.rects.length >= 4);
  assert.ok(intrusion(d, [flat(hole)]) < 0.005);
});

test('hole-free ring is unaffected by the holes path', async () => {
  const { decomposeRing } = await import('../js/madrid-footprint.js');
  const a = decomposeRing([-10, -10, -10, 10, 10, 10, 10, -10], { stripW: 4, minD: 0.4 });
  const b = decomposeRing([-10, -10, -10, 10, 10, 10, 10, -10], { stripW: 4, minD: 0.4, holes: [] });
  assert.equal(a.rects.length, b.rects.length);
  assert.equal(a.deviation, b.deviation);
});
