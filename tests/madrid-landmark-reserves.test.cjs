const assert = require('node:assert/strict');
const test = require('node:test');
const rect = (x0, x1, z0, z1) => [[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
test('source ring reservation preserves concave recesses and touching neighbors', async () => {
  const { footprintsOverlap } = await import('../js/madrid-landmark-reserves.js');
  const ring = [[0,0],[10,0],[10,10],[7,10],[7,3],[3,3],[3,10],[0,10]];
  assert.equal(footprintsOverlap(rect(4,6,4,8), ring), false, 'patio within source bounds remains free');
  assert.equal(footprintsOverlap(rect(10,14,1,5), ring), false, 'shared wall is not overlap');
  assert.equal(footprintsOverlap(rect(10,14,10,14), ring), false, 'corner touch is not overlap');
  assert.equal(footprintsOverlap(rect(9,14,1,5), ring), true, 'crossing facade overlaps');
  assert.equal(footprintsOverlap(rect(1,2,1,2), ring), true, 'fully enclosed mass overlaps');
  assert.equal(footprintsOverlap(rect(-1,11,-1,11), ring), true, 'enclosing mass overlaps');
  assert.equal(footprintsOverlap(rect(0,10,0,10), rect(0,10,0,10)), true, 'identical mass overlaps');
  assert.equal(footprintsOverlap([[9,0],[12,3],[9,6],[6,3]], ring), true, 'rotated frontage mass overlaps');
});
test('only source building rings reserve space; palace ring excludes nearby source footprints', async () => {
  const { GEO } = await import('../js/madrid-geodata.js');
  const { createMadridLandmarkReserves, overlapsMadridLandmark } = await import('../js/madrid-landmark-reserves.js');
  const reserves = createMadridLandmarkReserves({
    'Palacio de Cibeles': GEO.landmarks['Palacio de Cibeles'],
    'Fuente de Cibeles': GEO.landmarks['Fuente de Cibeles'],
    'Point': GEO.landmarks['Palacio de Cibeles - Ayuntamiento de Madrid']
  });
  assert.equal(reserves.length, 1);
  assert.equal(overlapsMadridLandmark(rect(1010,1020,-220,-210), reserves), true);
  assert.equal(overlapsMadridLandmark(rect(950,960,-280,-270), reserves), false, 'outside ring but within AABB');
  assert.equal(overlapsMadridLandmark(rect(900,920,-285,-270), reserves), false, 'fountain stays separate');
});
test('omitting a reserved building preserves later random decisions and emits no batches or metadata', async () => {
  const { readFileSync } = require('node:fs');
  const vm = require('node:vm');
  const source = readFileSync(require('node:path').join(__dirname, '../js/buildings.js'), 'utf8');
  const wrapper = source.slice(source.indexOf('  function commit(blk, b, o = {}) {'), source.indexOf('  function commitBuilding('));
  const blk = { footprints: [], awnings: [], maxH: 0, avenueFronts: { w: [], e: [] } };
  const buckets = [[]], colliders = [];
  let draws = 0;
  const commit = vm.runInNewContext(`(${wrapper.trim()})`, {
    madridLandmarkReserves: [{}], overlapsMadridLandmark: () => true, toWorld: (x,z) => [x,z], buckets, colliders,
    commitBuilding(scratch) {
      draws += 3;
      scratch.footprints.push({}); scratch.awnings.push({}); scratch.avenueFronts.w.push([0,5]); scratch.maxH = 20;
      buckets[0].push({}); colliders.push({});
    }
  });
  commit(blk, { parts: [{ x0: 0, x1: 2, z0: 0, z1: 2 }] });
  assert.equal(draws, 3, 'all original decoration decisions still execute');
  assert.deepEqual(blk, { footprints: [], awnings: [], maxH: 0, avenueFronts: { w: [], e: [] } });
  assert.deepEqual(buckets, [[]]);
  assert.deepEqual(colliders, []);
});
