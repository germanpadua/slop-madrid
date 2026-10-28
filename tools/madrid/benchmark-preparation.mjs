// Compare the pure algorithms with a reviewed git revision, without modifying the checkout.
// Usage: node tools/madrid/benchmark-preparation.mjs [baseline-ref] [tile-id]
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const baseline = process.argv[2] || '77921de';
const tileId = process.argv[3] || 'k3j0';
if (!/^[\w-]+$/.test(tileId)) throw new Error('Invalid tile id');
const root = fileURLToPath(new URL('../../', import.meta.url));
const { TILE } = await import(new URL(`../../js/geodata/tile-${tileId}.js`, import.meta.url));
const parcels = TILE.parcels.map(p => {
  const xs = p.ring.filter((_, i) => i % 2 === 0), zs = p.ring.filter((_, i) => i % 2 === 1);
  return { ...p, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
});
const timings = {};
for (const [module, methods] of [['madrid-footprint', ['decomposeRing']], ['madrid-adjacency', ['partyWallHeights', 'partyWallRuns']]]) {
  const source = execFileSync('git', ['show', `${baseline}:js/${module}.js`], { cwd: root, encoding: 'utf8' });
  const before = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const after = await import(new URL(`../../js/${module}.js`, import.meta.url));
  for (const method of methods) {
    const invoke = mod => method === 'decomposeRing'
      ? parcels.map(p => mod[method](p.ring, { stripW: 4, minD: 0.4, holes: p.holes || [] }))
      : mod[method](parcels);
    timings[method] = { beforeMs: [], afterMs: [] };
    for (let n = 0; n < 3; n++) {
      let start = performance.now();
      const expected = invoke(before);
      timings[method].beforeMs.push(performance.now() - start);
      start = performance.now();
      const actual = invoke(after);
      timings[method].afterMs.push(performance.now() - start);
      assert.deepEqual(actual, expected, `${method}, sample ${n}`);
    }
  }
}
console.log(JSON.stringify({ baseline, tileId, parcels: parcels.length, samples: 3, identical: true, timings }, null, 2));
