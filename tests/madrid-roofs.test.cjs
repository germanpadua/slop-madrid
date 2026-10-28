// tests/madrid-roofs.test.cjs — regression for the shared tejado rules (js/madrid-roofs.js): both Madrid
// render paths consume these decisions, so the rules are pinned here once.
const { test } = require('node:test');
const assert = require('node:assert');

// Parcels are built by CENTRE so the roll (which hashes the centre) stays fixed across shapes.
const PC = (cx, cz, w, d, h) => ({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, w, d, h });

// Deterministic centre that rolls "roof" (roll <= 0.72): scan once so tests don't depend on the
// hash function's particulars at a hardcoded point.
async function rollingPoint() {
  const { roofDecision } = await import('../js/madrid-roofs.js');
  for (let x = 0; x < 500; x += 7.3) {
    for (let z = 0; z < 500; z += 5.1) {
      if (roofDecision(PC(x, z, 12, 10, 14))) return { x, z, roofDecision };
    }
  }
  throw new Error('no rolling point found');
}

test('low, small and rolled-flat parcels stay flat', async () => {
  const { x, z, roofDecision } = await rollingPoint();
  assert.equal(roofDecision(PC(x, z, 12, 10, 8.9)), null); // too low
  assert.equal(roofDecision(PC(x, z, 5.9, 10, 14)), null); // too narrow
  assert.equal(roofDecision(PC(x, z, 12, 10, 14))?.kind, 'hip'); // control: same spot rolls a roof
});

test('single-span parcels get a hip with ridge along the long axis', async () => {
  const { x, z, roofDecision } = await rollingPoint();
  const wide = roofDecision(PC(x, z, 20, 12, 14));
  assert.equal(wide.kind, 'hip');
  assert.equal(wide.rot, 0);
  const deep = roofDecision(PC(x, z, 12, 20, 14));
  assert.equal(deep.kind, 'hip');
  assert.ok(Math.abs(deep.rot - Math.PI / 2) < 1e-9);
  assert.ok(wide.h >= 2 && wide.h <= 4.2);
});

test('towers stay single-mass hips even when wide', async () => {
  const { x, z, roofDecision } = await rollingPoint();
  const d = roofDecision(PC(x, z, 30, 28, 40));
  assert.equal(d?.kind, 'hip');
});

test('patio blocks get a ring; a poking neighbour forces flat (clash containment)', async () => {
  const { x, z, roofDecision } = await rollingPoint();
  const block = PC(x, z, 42, 34, 19);
  assert.equal(roofDecision(block, [block])?.kind, 'ring');
  // neighbour poking through the inner-slope band (not fully inside the opening)
  const poker = PC(x - 21 + 9, z - 17 + 8, 10, 8, 19);
  assert.equal(roofDecision(block, [block, poker]), null);
  // neighbour fully inside the opening pokes through the hole: no clash
  const inner = PC(x, z, 8, 8, 25);
  assert.equal(roofDecision(block, [block, inner])?.kind, 'ring');
  // short neighbours never clash
  const low = PC(x - 21 + 9, z - 17 + 8, 10, 8, 4);
  assert.equal(roofDecision(block, [block, low])?.kind, 'ring');
});

test('decisions are deterministic and palette index is in range', async () => {
  const { x, z, roofDecision } = await rollingPoint();
  const a = roofDecision(PC(x, z, 16, 12, 15));
  const b = roofDecision(PC(x, z, 16, 12, 15));
  assert.deepEqual(a, b);
  assert.ok(a.ci >= 0 && a.ci < 5);
});

test('tall towers always hip (flat mix does not apply above 22m)', async () => {
  const { roofDecision } = await import('../js/madrid-roofs.js');
  // #3 of block #315: 25.4x24.5, h=24.2 rolled flat by the 28% mix before the fix.
  const P = { x0: 0, x1: 25.4, z0: 0, z1: 24.5, w: 25.4, d: 24.5, h: 24.2 };
  const r = roofDecision(P, [P]);
  assert.equal(r && r.kind, 'hip');
});

test('hip suppressed when its base emerges <3m above a containing flat slab', async () => {
  const { roofDecision } = await import('../js/madrid-roofs.js');
  // Inner building h=10.1 inside a container parcel whose slab top is 9.7: only 0.4m of wall would show.
  const container = { x0: -30, x1: 30, z0: -30, z1: 30, w: 60, d: 60, h: 9.7 };
  const inner = { x0: 3, x1: 22, z0: -2, z1: 17, w: 19, d: 19, h: 10.1 };
  assert.equal(roofDecision(inner, [container, inner]), null);
  // 3.5m of wall showing above the slab reads as supported: keep the hip.
  const taller = { ...inner, h: 13.2 };
  const r = roofDecision(taller, [container, taller]);
  assert.equal(r && r.kind, 'hip');
});
