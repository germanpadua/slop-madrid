// tests/landmark-reserve.test.cjs — pure-geometry contract of js/landmark-reserve.js.
// Regression (Oct 2026): the seed massed buildings straight through Madrid's landmark volumes because
// the reserve list was still NYC's name table (every lookup missed). The reserves are now the real OSM
// rings, clipped by quadtree subdivision.
import { buildLandmarkReserves, ringContains, clipRectByRings } from '../js/landmark-reserve.js';
import { test } from 'node:test';
import assert from 'node:assert';

// square ring helper: flat [x,z,...]
const square = (x0, z0, x1, z1) => [x0, z0, x1, z0, x1, z1, x0, z1];

test('buildLandmarkReserves keeps ringed, wide, non-open-space sites', () => {
  const sites = {
    'Palacio de Linares': { ring: square(0, 0, 40, 30), w: 40, d: 30, h: 20 },
    'Plaza de Cibeles': { ring: square(100, 100, 160, 160), w: 60, d: 60, h: 0 },
    'Iglesia pequeña': { ring: square(200, 0, 205, 8), w: 5, d: 8, h: 12 }, // too narrow
    'Sin anillo': { x: 300, z: 0, w: 30, h: 20 }
  };
  const res = buildLandmarkReserves(sites, /^(Plaza|Glorieta)\b/);
  assert.deepEqual(res.map((r) => r.name), ['Palacio de Linares']);
  assert.deepEqual(res[0].bb, { x0: 0, x1: 40, z0: 0, z1: 30 });
});

test('ringContains is exact on edges and concave shapes', () => {
  const ring = square(0, 0, 10, 10);
  assert.equal(ringContains(ring, 5, 5), true);
  assert.equal(ringContains(ring, 15, 5), false);
  const lShape = [0, 0, 10, 0, 10, 4, 4, 4, 4, 10, 0, 10];
  assert.equal(ringContains(lShape, 2, 8), true);
  assert.equal(ringContains(lShape, 8, 8), false); // the notch
});

test('clipRectByRings removes only the covered part of a lot', () => {
  const reserves = buildLandmarkReserves({ P: { ring: square(10, 10, 30, 30), w: 20, d: 20, h: 24 } }, /$^/);
  // lot fully inside the ring -> gone
  assert.deepEqual(clipRectByRings([12, 14, 12, 14], reserves, (x, z) => [x, z]), []);
  // lot fully outside -> untouched
  assert.deepEqual(clipRectByRings([0, 5, 0, 5], reserves, (x, z) => [x, z]), [[0, 5, 0, 5]]);
  // lot straddling the west wall: only cells whose centre is inside are dropped
  const parts = clipRectByRings([0, 20, 12, 14], reserves, (x, z) => [x, z]);
  assert.ok(parts.length > 0);
  for (const [x0, x1] of parts) assert.ok(x1 <= 10 + 1e-9, `cell (${x0}, ${x1}) crosses the ring wall`);
  // total kept area outside the ring is conserved
  const area = parts.reduce((s, [x0, x1, z0, z1]) => s + (x1 - x0) * (z1 - z0), 0);
  assert.ok(Math.abs(area - 20) < 1e-6, `kept ${area} m², expected the 20 m² outside the ring`);
});

test('clipRectByRings applies the block frame transform (rotated frontage)', () => {
  const reserves = buildLandmarkReserves({ P: { ring: square(60, 60, 80, 80), w: 20, d: 20, h: 24 } }, /$^/);
  // local frame rotated 90° about (50, 50): local (x,z) -> world (z, 100 - x)
  const toWorld = (cx, cz) => [cz, 100 - cx];
  // local centre (30,70) -> world (70,70): INSIDE the ring, though far from it in local coords
  assert.deepEqual(clipRectByRings([28, 32, 68, 72], reserves, toWorld), []);
  // local centre (70,30) -> world (30,30): outside -> kept
  assert.deepEqual(clipRectByRings([68, 72, 28, 32], reserves, toWorld), [[68, 72, 28, 32]]);
});

test('oversized lots are subdivided before the centre test (no giant centre mistake)', () => {
  const reserves = buildLandmarkReserves({ P: { ring: square(40, 40, 60, 60), w: 20, d: 20, h: 24 } }, /$^/);
  // 200x200 lot: the centre is far outside, but a blind centre test would keep the ring buried
  const parts = clipRectByRings([0, 200, 0, 200], reserves, (x, z) => [x, z]);
  const buried = parts.some(([x0, x1, z0, z1]) => x0 < 60 && x1 > 40 && z0 < 60 && z1 > 40 &&
    (x1 - x0) > 1 && ringContains(reserves[0].pts, (x0 + x1) / 2, (z0 + z1) / 2));
  assert.equal(buried, false, 'no kept cell has its centre inside the ring');
});
