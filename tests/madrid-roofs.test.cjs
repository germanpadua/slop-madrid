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
