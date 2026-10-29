const { test } = require('node:test');
const assert = require('node:assert/strict');

const roof = (i, extra = {}) => ({ x: i, y: 20, z: -10, w: 10, d: 20, h: 3, rot: 0, ci: 2, slate: false, ...extra });
test('persistent roof cells retain every existing roof beyond the old per-kind pool cap', async () => {
  const { collectRoofBatches } = await import('../js/madrid-roof-batches.js');
  const blocks = [{ hipRoofs: Array.from({ length: 4000 }, (_, i) => roof(i)) }];
  const original = JSON.stringify(blocks);
  const cells = collectRoofBatches(blocks);
  assert.equal(cells.reduce((n, cell) => n + cell.roofs.length, 0), 4000);
  assert.equal(JSON.stringify(blocks), original, 'source decisions remain unchanged');
  assert.ok(cells.length > 1, 'distant roofs can be culled independently');
  assert.equal(new Set(cells.flatMap(c => c.roofs.map(r => r.x))).size, 4000);
});

test('hip and patio ring roofs retain the existing world transforms and palette', async () => {
  const { collectRoofBatches } = await import('../js/madrid-roof-batches.js');
  const cells = collectRoofBatches([{ ry: 0.4, hipRoofs: [roof(1), roof(2, { ring: true, rot: Math.PI / 2, slate: true })] }]);
  assert.equal(cells.length, 2, 'each geometry has its own batch');
  const hip = cells.find(c => !c.ring).roofs[0], ring = cells.find(c => c.ring).roofs[0];
  assert.equal(hip.yaw, 0.4);
  assert.equal(hip.width, 10.6);
  assert.equal(hip.depth, 20.6);
  assert.equal(ring.width, 20.6);
  assert.equal(ring.depth, 10.6);
  assert.equal(ring.yaw, 0.4 + Math.PI / 2);
  assert.equal(ring.slate, true);
  assert.equal(ring.ci, 2);
});
