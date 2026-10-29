const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadModule } = require('./helpers/module.cjs');

// Regression: a present-but-malformed farBuildings (missing typed arrays, e.g. from a stale
// cached preparation) must not crash the worker transfer-list build; the consumer skips it.
function runWorker(prepared) {
  const self = {
    onmessage: null,
    posted: [],
    postMessage(msg, transfer) { this.posted.push({ msg, transfer }); },
  };
  loadModule(fs.readFileSync(path.join(__dirname, '../js/madrid-tile-worker.js'), 'utf8'), {
    imports: { './madrid-tile-preparation.js': { prepareTile: () => prepared } },
    globals: { self, performance },
    filename: 'madrid-tile-worker.js',
  });
  assert.equal(typeof self.onmessage, 'function');
  self.onmessage({ data: { requestId: 1, tile: { id: 'probe' } } });
  assert.equal(self.posted.length, 1);
  return self.posted[0];
}

test('worker survives farBuildings with missing indices array', () => {
  const { msg, transfer } = runWorker({
    indices: [], footprints: [], heights: [], runs: [], roofs: { hips: [], rings: [] },
    farBuildings: { positions: new Float32Array(9), normals: new Float32Array(9), colors: new Float32Array(9), indices: undefined },
  });
  assert.equal(msg.error, undefined);
  assert.ok(Array.isArray(transfer) && transfer.length === 0);
});

test('worker survives farBuildings with missing positions array', () => {
  const { msg, transfer } = runWorker({
    indices: [], footprints: [], heights: [], runs: [], roofs: { hips: [], rings: [] },
    farBuildings: { positions: undefined, normals: new Float32Array(9), colors: new Float32Array(9), indices: new Uint32Array(3) },
  });
  assert.equal(msg.error, undefined);
  assert.ok(Array.isArray(transfer) && transfer.length === 0);
});

test('worker with null farBuildings transfers nothing (unchanged path)', () => {
  const { msg, transfer } = runWorker({
    indices: [], footprints: [], heights: [], runs: [], roofs: { hips: [], rings: [] }, farBuildings: null,
  });
  assert.equal(msg.error, undefined);
  assert.ok(Array.isArray(transfer) && transfer.length === 0);
});

test('worker with well-formed farBuildings transfers all four buffers (non-regression)', () => {
  const fb = {
    positions: new Float32Array(9), normals: new Float32Array(9),
    colors: new Float32Array(9), indices: new Uint32Array(3),
  };
  const { msg, transfer } = runWorker({
    indices: [], footprints: [], heights: [], runs: [], roofs: { hips: [], rings: [] }, farBuildings: fb,
  });
  assert.equal(msg.error, undefined);
  assert.equal(transfer.length, 4);
  assert.equal(transfer[0], fb.positions.buffer);
  assert.equal(transfer[3], fb.indices.buffer);
});
