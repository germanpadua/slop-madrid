const test = require('node:test');
const assert = require('node:assert/strict');

test('off-thread preparation preserves patios and original parcel indices across rejected parcels', async () => {
  const { prepareTile } = await import('../js/madrid-tile-preparation.js');
  const { decomposeRing } = await import('../js/madrid-footprint.js');
  const exterior = [0,0,20,0,20,20,0,20];
  const hole = [5,5,15,5,15,15,5,15];
  const prepared = prepareTile({ parcels: [{ ring: exterior, h: 0 }, { ring: exterior, h: 10, holes: [hole] }] });
  assert.deepEqual(prepared.indices, [1]);
  assert.deepEqual(prepared.footprints[1], decomposeRing(exterior, { stripW: 4, minD: 0.4, holes: [hole] }));
  assert.deepEqual(prepared.heights, [[0,0,0,0]]);
  assert.ok(prepared.runs[0].every(r => r.length === 0));
});

test('prepared roof transforms match the pre-worker tile renderer for all k3j0 parcels', async () => {
  const { createHash } = require('node:crypto');
  const { TILE } = await import('../js/geodata/tile-k3j0.js');
  const { prepareTile } = await import('../js/madrid-tile-preparation.js');
  const { roofs } = prepareTile(TILE);
  assert.equal(roofs.hips.length, 382);
  assert.equal(roofs.rings.length, 0);
  // Original d953fe7 roof loop, including rotations, palette, eaves and patio suppression.
  assert.equal(createHash('sha256').update(JSON.stringify(roofs)).digest('hex'),
    '0c6d7c8712b0fca155de502512f1b3dd7949c63b6a8366bcd5fed09208a9dc17');
});
