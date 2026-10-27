const assert = require('node:assert/strict');
const { readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

// Phase-2 geodata contract: the "almendra central" box must be covered by real land + real water, carry the named
// landmarks with IDEAM heights, and never place a parcel outside the box or in the river.

const root = join(__dirname, '..');
let GEO;
let PHASE;
test.before(async () => {
  ({ GEO } = await import('../js/madrid-geodata.js'));
  ({ PHASES: PHASE } = await import('../tools/madrid/config.mjs'));
});

const areaOf = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) a += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
  return Math.abs(a) / 2;
};
const boundsOf = (ring) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]);
    z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]);
  }
  return { x0, x1, z0, z1 };
};
const inside = (ring, x, z) => {
  let hit = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[j], az = ring[j + 1], bx = ring[i], bz = ring[i + 1];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) hit = !hit;
  }
  return hit;
};

test('phase-2 geodata is the almendra central box (UTM 30N, no rotation, Sol origin)', () => {
  assert.equal(GEO.phase, 'fase2');
  assert.equal(GEO.frame.madrid, true);
  assert.equal(GEO.frame.bearingDeg, 0);
  assert.equal(PHASE.fase2.utm.length, 4);
  const [x0, y0, x1, y1] = PHASE.fase2.utm;
  assert.ok(x1 - x0 > 3000 && y1 - y0 > 2500, 'phase-2 box is the ~8 km² almendra, not the phase-1 box');
});

test('land rings + water tile the whole phase box (no missing ground, no invented ground)', () => {
  const box = GEO.manhattan;
  const bb = boundsOf(box);
  const boxArea = (bb.x1 - bb.x0) * (bb.z1 - bb.z0);
  assert.ok(GEO.landRings.length >= 1, 'at least the main land piece');
  assert.deepEqual(GEO.landRings[0], GEO.manhattan, 'the coastline is the main land piece');
  const landArea = GEO.landRings.reduce((t, r) => t + areaOf(r), 0);
  const waterArea = GEO.water.reduce((t, r) => t + areaOf(r), 0);
  const covered = landArea + waterArea;
  assert.ok(covered > boxArea * 0.9, `land+water covers the box (${Math.round(covered / 1e6)} of ${Math.round(boxArea / 1e6)} km²)`);
  assert.ok(landArea < boxArea * 1.02, 'land never exceeds the box');
  // every ring sits inside the box (raster tracing rounds outward by at most ~2 m)
  const pad = 3;
  for (const ring of [...GEO.landRings, ...GEO.water]) {
    const r = boundsOf(ring);
    assert.ok(r.x0 >= bb.x0 - pad && r.x1 <= bb.x1 + pad && r.z0 >= bb.z0 - pad && r.z1 <= bb.z1 + pad);
  }
});

test('the Manzanares is the real channel: a curved OSM polygon, not a square lake', () => {
  assert.ok(GEO.water.length >= 1, 'water polygons exist');
  const river = GEO.water.reduce((a, r) => (areaOf(r) > areaOf(a) ? r : a));
  const area = areaOf(river);
  assert.ok(area > 20000, `the river channel is a real water body (${Math.round(area)} m²)`);
  assert.ok(area < 1.2e6, 'no harbour-sized "water" in an 8 km² inland box');
  assert.ok(river.length / 2 > 40, 'the channel follows many OSM vertices (a square would be 4)');
  const bb = boundsOf(river);
  assert.ok(bb.z1 - bb.z0 > 800, 'the Manzanares runs north-south across the box');
  assert.ok(bb.x0 < -1000, 'the channel lies on the west side of the frame, by Príncipe Pío / Madrid Río');
  // no two water polygons may be overlapping duplicates of the same OSM area
  const total = GEO.water.reduce((t, r) => t + areaOf(r), 0);
  assert.ok(total < 1.6e6, `water stays river-sized (${Math.round(total)} m²)`);
});

test('landmarks of the almendra are present with real IDEAM heights', () => {
  const required = [
    'Templo de Debod', 'Palacio Real', 'Catedral de la Almudena', 'Plaza de España',
    'Museo Reina Sofía', 'Estación de Atocha', 'Estación de Príncipe Pío'
  ];
  for (const name of required) {
    const lm = GEO.landmarks[name];
    assert.ok(lm, `${name} is in GEO.landmarks`);
    assert.ok(lm.ring.length >= 6, `${name} has a real footprint`);
    assert.ok(lm.w > 8 && lm.d > 8, `${name} has a real extent`);
  }
  // heights: measured from the cadastral parcels (IDEAM), inside the real storey range of these buildings
  // Heights come from those sources only: the IDEAM cadastral layer, or the OSM height/levels tags as a fallback.
  // Open-air monuments with neither (Debod: no cadastral parcel, no height tag) must not get an invented number.
  const heights = {
    'Palacio Real': [15, 50, 'IDEAM'],
    'Catedral de la Almudena': [20, 80, 'IDEAM'],
    'Museo Reina Sofía': [10, 60, 'OSM'],
    'Estación de Atocha': [8, 60, 'IDEAM'],
    'Estación de Príncipe Pío': [8, 50, 'IDEAM']
  };
  for (const [name, [min, max, src]] of Object.entries(heights)) {
    const lm = GEO.landmarks[name];
    assert.ok(Number.isFinite(lm.h), `${name} has a height`);
    assert.ok(lm.h >= min && lm.h <= max, `${name} height ${lm.h} m is plausible`);
    assert.equal(lm.hSrc, src, `${name} height comes from ${src}`);
  }
  assert.equal(GEO.landmarks['Templo de Debod'].h, undefined, 'Debod carries no invented height');
  assert.equal(GEO.landmarks['Plaza de España'].h, undefined, 'a square is not a building');
  // Plaza de España is a square: it must be a large open footprint with no building height
  const plaza = GEO.landmarks['Plaza de España'];
  assert.ok(plaza.w * plaza.d > 3000, 'Plaza de España covers more than 3 000 m²');
});

test("Gran Vía runs complete from Plaza de España to Alcalá in the frame", () => {
  const runs = GEO.roads.filter((r) => r[0] === 'Gran Vía');
  assert.ok(runs.length >= 1, 'Gran Vía is in the road layer');
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  let length = 0;
  for (const [, , , , , pts] of runs) {
    for (let i = 0; i < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
      z0 = Math.min(z0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1]);
    }
    for (let i = 2; i < pts.length; i += 2) length += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  }
  assert.ok(x0 < -590, 'west end (Plaza de España side) is mapped');
  assert.ok(x1 > 350, 'east end (Alcalá side) is mapped');
  assert.ok(length > 1200, `the whole 1.3 km avenue is mapped (${Math.round(length)} m)`);
  assert.ok(z0 < -330 && z1 > -830, 'the canyon keeps its real north-south run');
});

test('every parcel sits inside the box, off the water, with a real cadastral height', () => {
  const bb = boundsOf(GEO.manhattan);
  const waterBoxes = GEO.water.map((r) => ({ ring: r, bb: boundsOf(r) }));
  let n = 0;
  for (const parcels of GEO.parcels) {
    for (const { ring, h } of parcels) {
      n++;
      let cx = 0, cz = 0;
      for (let i = 0; i < ring.length; i += 2) { cx += ring[i]; cz += ring[i + 1]; }
      cx /= ring.length / 2;
      cz /= ring.length / 2;
      // 1 m tolerance: the generated rings are rounded to decimetres, so a centroid on the frame edge can move ~5 cm
      assert.ok(cx >= bb.x0 - 1 && cx <= bb.x1 + 1 && cz >= bb.z0 - 1 && cz <= bb.z1 + 1, `parcel ${n} inside the frame`);
      assert.ok(h >= 2.4 && h <= 250, `parcel ${n} height ${h} m is a real building`);
      for (const w of waterBoxes) {
        if (cx < w.bb.x0 || cx > w.bb.x1 || cz < w.bb.z0 || cz > w.bb.z1) continue;
        assert.equal(inside(w.ring, cx, cz), false, `parcel ${n} is not in the river`);
      }
    }
  }
  // 2.4x phase 1 (11 412): the west half of the almendra is less dense than Sol-Cibeles (Casa de Campo, Madrid Río,
  // the Atocha yards and the parks carry no parcels), while the box is 4.4x bigger
  assert.ok(n > 25000, `the almendra carries the full cadastral layer (${n} parcels)`);
});

test('phase-2 city is ~4x phase 1: blocks, parcels, roads and road graph all grew', () => {
  assert.ok(GEO.blocks.length > 500, `block slabs ${GEO.blocks.length} (phase 1: 139)`);
  assert.ok(GEO.roads.length > 2500, `road polylines ${GEO.roads.length} (phase 1: 879)`);
  assert.ok(GEO.roadGraph.links.length > 1500, `graph links ${GEO.roadGraph.links.length} (phase 1: 688)`);
  assert.ok(GEO.roadGraph.nodes.length / 2 > 3000, `graph nodes ${GEO.roadGraph.nodes.length / 2} (phase 1: 1376)`);
  assert.ok(GEO.barrios.length >= 5, 'administrative barrios came from OSM boundaries');
  for (const b of GEO.barrios) assert.ok(b.name && b.ring.length >= 6);
});

test('the bulk layer is split out of the core module', () => {
  const core = statSync(join(root, 'js/madrid-geodata.js')).size;
  const blocks = statSync(join(root, 'js/madrid-geodata-blocks.js')).size;
  assert.ok(readFileSync(join(root, 'js/madrid-geodata-blocks.js'), 'utf8').includes('export const BLOCKS'));
  assert.ok(core < 3 * 1024 * 1024, `core geodata stays under 3 MB (${(core / 1024).toFixed(0)} KB)`);
  assert.ok(blocks > 0);
});
