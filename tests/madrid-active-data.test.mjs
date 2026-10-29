import test from 'node:test';
import assert from 'node:assert/strict';
import { createActiveMadridData } from '../js/madrid-active-data.js';

const road = (name, coords, dir = 0) => [name, 9, dir, 2, 0, coords];
const seed = { frame: { bbox: [-100, -100, 100, 100] }, roads: [road('Mayor', [0, 0, 100, 0])] };

test('active graph joins a real shared vertex, dedupes overlap, obeys one-way and shrinks on eviction', () => {
  const m = createActiveMadridData(seed);
  const before = m.snapshot();
  const tile = { id: 'east', core: [[100, -100, 300, 100]], roads: [road('Mayor', [0, 0, 100, 0]), road('Alcalá', [100, 0, 200, 40, 300, 0], 1)] };
  m.set(tile);
  assert.equal(m.snapshot().roadGraph.links.length, 3);
  assert.deepEqual(m.route({ x: 0, z: 0 }, { x: 300, z: 0 }), [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 200, z: 40 }, { x: 300, z: 0 }]);
  assert.deepEqual(m.route({ x: 300, z: 0 }, { x: 0, z: 0 }), [], 'one way cannot be driven backwards');
  assert.equal(m.set(tile), false, 'idempotent notification');
  assert.ok(m.remove('east'));
  assert.equal(m.snapshot().roadGraph.links.length, before.roadGraph.links.length);
  assert.equal(m.remove('fase2'), false);
  assert.deepEqual(m.route({ x: 0, z: 0 }, { x: 300, z: 0 }), []);
});

test('crossing lines without a shared source vertex are not invented intersections', () => {
  const m = createActiveMadridData({ ...seed, roads: [road('bridge', [-90, 0, 90, 0]), road('below', [0, -90, 0, 90])] });
  assert.equal(m.snapshot().roadGraph.nodes.length, 8);
  assert.deepEqual(m.route({ x: -90, z: 0 }, { x: 0, z: 90 }), []);
});

test('generated tile graphs retain curves and do not fall back to decorative road lines', () => {
  const m = createActiveMadridData({ ...seed, roads: [], roadGraph: { nodes: [0, 0, 100, 0], names: ['Curva'], links: [[0, 1, 0, 8, 1, 0, [50, 30]]] } });
  assert.equal(m.snapshot().roadGraph.links.length, 2);
  assert.deepEqual(m.route({ x: 0, z: 0 }, { x: 100, z: 0 }), [{ x: 0, z: 0 }, { x: 50, z: 30 }, { x: 100, z: 0 }]);
});

test('ground clamping respects non-rectangular active coverage and never lands in a pending gap', () => {
  const m = createActiveMadridData(seed);
  m.set({ id: 'far', roads: [], core: [[300, -100, 500, 100]] });
  assert.deepEqual(m.clamp(350, 0), { x: 350, z: 0 });
  const gap = m.clamp(220, 0, 8);
  assert.ok(gap.x <= 100 || gap.x >= 300);
  m.remove('far');
  assert.deepEqual(m.clamp(350, 0, 8), { x: 92, z: 0 });
});

test('live city lookups and sidewalk height domain grow with a tile and are removed on eviction', async () => {
  const config = await import('../js/city-config.js');
  const { GEO } = await import('../js/madrid-geodata.js');
  const seedBox = [config.ISLAND_BOUNDS.minX, config.ISLAND_BOUNDS.minZ, config.ISLAND_BOUNDS.maxX, config.ISLAND_BOUNDS.maxZ];
  const model = createActiveMadridData({ ...GEO, core: [seedBox] });
  const roadCount = config.ROADS.length;
  const blockCount = config.BLOCKS.length;
  model.set({ id: 'probe', core: [[9000, 9000, 9500, 9500]],
    roads: [road('Test de tesela', [9100, 9100, 9200, 9100])],
    blocks: [[[9110, 9120, 9190, 9120, 9190, 9200, 9110, 9200], [], 0, '', 0, 0]] });
  config.setActiveMadridData(model);
  assert.ok(config.nearestRoads(9150, 9100).some((r) => r.road.name === 'Test de tesela'));
  assert.ok(config.blockAt(9150, 9150));
  assert.equal(config.ISLAND_BOUNDS.maxX, 9500);
  assert.deepEqual(config.clampToMadridGround(9150, 9150), { x: 9150, z: 9150 });
  model.remove('probe'); config.setActiveMadridData(model);
  assert.equal(config.ROADS.length, roadCount);
  assert.equal(config.BLOCKS.length, blockCount);
  assert.equal(config.blockAt(9150, 9150), null);
  assert.deepEqual(config.nearestRoads(9150, 9100), []);
});
