const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tools/madrid/tiles.json')));

const owns = (tile, x, z) => tile.core.some(([x0,z0,x1,z1]) => x >= x0 && x < x1 && z >= z0 && z < z1);

test('sourced trees and signals belong to one resident tile with traceable OSM identities', async () => {
  const seen = { trees: new Set(), signals: new Set() };
  let treeCount = 0;
  for (const tile of manifest.tiles.filter(t => t.status === 'ready')) {
    const module = await import('../' + tile.module);
    const data = (module.GEO || module.TILE).streetFeatures;
    assert.equal(data.source.license, 'ODbL-1.0');
    assert.match(data.source.sha256, /^[a-f0-9]{64}$/);
    assert.equal(data.source.sha256, manifest.streetFeaturesSource.sha256);
    for (const kind of ['trees', 'signals']) for (const point of data[kind]) {
      assert.ok(Number.isSafeInteger(point.id) && point.id > 0);
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
      assert.ok(owns(tile, point.x, point.z), `${kind} ${point.id} belongs to ${tile.id}`);
      assert.ok(!seen[kind].has(point.id), `duplicate OSM ${kind} ${point.id}`);
      seen[kind].add(point.id);
      if (kind === 'trees') treeCount++;
    }
  }
  assert.ok(treeCount > 10000, `real tree coverage retained: ${treeCount}`);
});

test('street segments retain source node identity, grade/access tags and unique core ownership', async () => {
  const nodes = new Map(), segments = new Set();
  for (const tile of manifest.tiles.filter(t => t.status === 'ready')) {
    const module = await import('../' + tile.module);
    const ways = (module.GEO || module.TILE).streetFeatures.ways;
    assert.ok(ways.length > 0);
    for (const way of ways) {
      assert.ok(Number.isSafeInteger(way.id) && way.tags.highway);
      assert.ok(way.nodes.length >= 2);
      for (const [id,x,z] of way.nodes) {
        assert.ok(Number.isSafeInteger(id) && Number.isFinite(x) && Number.isFinite(z));
        if (nodes.has(id)) assert.deepEqual([x,z], nodes.get(id), `OSM node ${id} keeps coordinates at seams`);
        nodes.set(id,[x,z]);
      }
      for (let i = 1; i < way.nodes.length; i++) {
        const a = way.nodes[i-1], b = way.nodes[i];
        assert.ok(owns(tile,(a[1]+b[1])/2,(a[2]+b[2])/2), 'source segment belongs to its midpoint owner');
        const key = `${way.id}:${a[0]}:${b[0]}`;
        assert.ok(!segments.has(key), `duplicate segment ${key}`);
        segments.add(key);
      }
    }
  }
  assert.ok(nodes.size > 10000);
});
