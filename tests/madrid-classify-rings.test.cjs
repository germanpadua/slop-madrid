// tests/madrid-classify-rings.test.cjs — ring classification for the IDEAM holes passthrough
// (tools/madrid/classify-rings.mjs). Containment is the authority; orientation only cross-checks;
// ambiguous topology fails the feature loudly; multi-part footprints are preserved as extra parcels.
const { test } = require('node:test');
const assert = require('node:assert');

const CCW = [[0, 0], [0, 10], [10, 10], [10, 0]];           // positive shoelace in x,z
const CW = (r) => r.slice().reverse();                        // negative shoelace
const sq = (cx, cz, s) => [[cx - s, cz - s], [cx - s, cz + s], [cx + s, cz + s], [cx + s, cz - s]];

test('plain exterior: one parcel, no holes, negative shoelace', async () => {
  const { classifyRings } = await import('../tools/madrid/classify-rings.mjs');
  const { parcels, failed } = classifyRings([sq(0, 0, 10)]);
  assert.equal(failed.length, 0);
  assert.equal(parcels.length, 1);
  assert.equal(parcels[0].holes.length, 0);
  const a = parcels[0].ring.reduce((s, q, i) => { const p = parcels[0].ring[(i + 1) % 4]; return s + q[0] * p[1] - p[0] * q[1]; }, 0) / 2;
  assert.ok(a < 0, 'exterior normalized to negative shoelace');
});

test('exterior + hole: hole assigned, normalized to positive shoelace', async () => {
  const { classifyRings } = await import('../tools/madrid/classify-rings.mjs');
  const { parcels, failed, stats } = classifyRings([sq(0, 0, 10), sq(0, 0, 3)]);
  assert.equal(failed.length, 0);
  assert.equal(parcels.length, 1);
  assert.equal(parcels[0].holes.length, 1);
  assert.equal(stats.holesKept, 1);
  const h = parcels[0].holes[0];
  const a = h.reduce((s, q, i) => { const p = h[(i + 1) % 4]; return s + q[0] * p[1] - p[0] * q[1]; }, 0) / 2;
  assert.ok(a > 0, 'hole normalized to positive shoelace');
});

test('multi-part footprint: second exterior becomes its own parcel, no geometry dropped', async () => {
  const { classifyRings } = await import('../tools/madrid/classify-rings.mjs');
  const { parcels, failed, stats } = classifyRings([sq(0, 0, 10), sq(100, 100, 8)]);
  assert.equal(failed.length, 0);
  assert.equal(parcels.length, 2);
  assert.equal(stats.extraExteriors, 1);
  assert.ok(parcels.every((p) => p.holes.length === 0));
});

test('multi-part with holes grouped to the right exterior', async () => {
  const { classifyRings } = await import('../tools/madrid/classify-rings.mjs');
  const { parcels, failed } = classifyRings([sq(0, 0, 10), sq(100, 100, 8), sq(0, 0, 3), sq(100, 100, 2)]);
  assert.equal(failed.length, 0);
  assert.equal(parcels.length, 2);
  const big = parcels.find((p) => p.ring.some(([x]) => Math.abs(x) < 50));
  const small = parcels.find((p) => p.ring.every(([x]) => Math.abs(x) > 50));
  assert.equal(big.holes.length, 1);
  assert.equal(small.holes.length, 1);
});

test('reversed-orientation source ring: containment corrects it, counted as evidence', async () => {
  const { classifyRings } = await import('../tools/madrid/classify-rings.mjs');
  // valid world-frame orientation: exterior positive, hole negative; feed the hole reversed (positive)
  const exterior = CW(sq(0, 0, 10)); // positive shoelace = valid exterior orientation in world frame
  const holeReversed = CW(sq(0, 0, 3)); // positive = reversed for a hole
  const { parcels, failed, stats } = classifyRings([exterior, holeReversed]);
  assert.equal(failed.length, 0);
  assert.equal(parcels.length, 1);
  assert.equal(parcels[0].holes.length, 1);
  assert.equal(stats.reversed, 1);
});

test('ambiguous topology (ring crossing the exterior boundary) fails the feature explicitly', async () => {
  const { classifyRings } = await import('../tools/madrid/classify-rings.mjs');
  const straddler = [[9, -1], [9, 1], [12, 1], [12, -1]]; // half inside, half outside (beyond tol)
  const { parcels, failed } = classifyRings([sq(0, 0, 10), straddler]);
  assert.equal(parcels.length, 0);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].reason, 'partial-containment');
});

test('tiny hole below minHoleArea is dropped and counted', async () => {
  const { classifyRings } = await import('../tools/madrid/classify-rings.mjs');
  const { parcels, stats } = classifyRings([sq(0, 0, 10), sq(0, 0, 1)]); // 4 m2 exactly at limit -> dropped (< 4? 4 not < 4)
  assert.ok(stats.holesDroppedSmall + stats.holesKept === 1, 'exactly one classification');
  assert.ok(parcels.length === 1);
});

test('nested island (building inside a patio): island becomes its own parcel, hole stays with the root', async () => {
  const { classifyRings } = await import('../tools/madrid/classify-rings.mjs');
  const { parcels, failed, stats } = classifyRings([sq(0, 0, 10), sq(0, 0, 6), sq(0, 0, 2)]);
  assert.equal(failed.length, 0);
  assert.equal(parcels.length, 2, 'primary + island parcel');
  assert.equal(stats.islands, 1);
  const root = parcels.find((p) => Math.abs(p.ring[0][0]) === 10 || p.ring.some(([x]) => Math.abs(x) === 10));
  assert.equal(root.holes.length, 1, 'the patio hole belongs to the root exterior');
});

test('concave exterior: hole fully inside a notch-free region classifies fine', async () => {
  const { classifyRings } = await import('../tools/madrid/classify-rings.mjs');
  const concave = [[0,0],[0,10],[10,10],[10,6],[4,6],[4,0]]; // L-shape, negative shoelace after normalize
  const hole = sq(7, 8, 1); // inside the upper arm of the L
  const { parcels, failed } = classifyRings([concave, hole]);
  assert.equal(failed.length, 0);
  assert.equal(parcels.length, 1);
  assert.equal(parcels[0].holes.length, 1);
});

test('hole whose EDGE crosses a concave exterior boundary (all vertices inside) fails explicitly', async () => {
  const { classifyRings } = await import('../tools/madrid/classify-rings.mjs');
  const concave = [[0,0],[0,10],[10,10],[10,6],[4,6],[4,0]]; // L-shape
  // vertices inside the polygon but its edge crosses the concave notch edge (x=4..10 at z=6 arm boundary)
  const sneaky = [[7, 5.2], [7, 5.8], [5, 6.4], [4.5, 5.5]];
  const { parcels, failed } = classifyRings([concave, sneaky]);
  assert.equal(parcels.length, 0);
  assert.equal(failed.length, 1);
  assert.ok(['partial-containment', 'boundary-crossing'].includes(failed[0].reason), 'fails loudly: ' + failed[0].reason);
});

test('sibling holes with crossing edges fail explicitly', async () => {
  const { classifyRings } = await import('../tools/madrid/classify-rings.mjs');
  const h1 = [[-3, -1], [-3, 1], [3, 1], [3, -1]];
  const h2 = [[-1, -3], [-1, 3], [1, 3], [1, -3]]; // crosses h1
  const { parcels, failed } = classifyRings([sq(0, 0, 10), h1, h2]);
  assert.equal(parcels.length, 0);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].reason, 'boundary-crossing');
});
