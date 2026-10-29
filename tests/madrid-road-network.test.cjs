const assert = require('node:assert/strict');
const test = require('node:test');

// Pure circulation-network helpers: lane matching for actors migrated onto a rebuilt resident
// graph, the rehydrated lane-curve runtime, ground clearance queries, resident block lookup and
// the service snapshot that decides which source data survives a tile eviction.

function load() {
  return import('../js/madrid-road-matching.js').then(async (matching) => {
    const network = await import('../js/road-network.js');
    const service = await import('../js/madrid-road-network.js');
    return { matchLane: matching.matchLane, ...network, ...service };
  });
}

function edge({ x = 0, z = 0, dx = 1, dz = 0, len = 100, half = 8, lanes = [-3, 3], axis = 'ave', id = 0 } = {}) {
  return { id, sx: x, sz: z, dx, dz, rx: -dz, rz: dx, len, half, lanes, axis };
}

test('a pose keeps the equivalent lane and projects to its position along it', async () => {
  const { matchLane } = await load();
  const road = edge();
  const match = matchLane([road], { x: 50, z: 3, tx: 1, tz: 0, half: 2.2, halfWidth: 0.9 });
  assert.ok(match);
  assert.equal(match.edge, road);
  assert.equal(match.lane, 1);
  assert.ok(Math.abs(match.s - 50) < 1e-9);
});

test('a pose across the roadway or against the flow has no equivalent lane', async () => {
  const { matchLane } = await load();
  const road = edge();
  assert.equal(matchLane([road], { x: 50, z: 40, tx: 1, tz: 0, half: 2.2, halfWidth: 0.9 }), null);
  assert.equal(matchLane([road], { x: 50, z: 0, tx: -1, tz: 0, half: 2.2, halfWidth: 0.9 }), null);
  assert.equal(matchLane([road], { x: 130, z: 0, tx: 1, tz: 0, half: 2.2, halfWidth: 0.9 }), null);
});

test('buses only migrate onto avenue edges', async () => {
  const { matchLane } = await load();
  const street = edge({ axis: 'st' });
  const avenue = edge({ id: 1 });
  const pose = { x: 50, z: 3, tx: 1, tz: 0, half: 6, halfWidth: 1.3, bus: true };
  assert.equal(matchLane([street], pose), null);
  assert.equal(matchLane([street, avenue], pose).edge, avenue);
});

test('the best aligned lane among overlapping roads wins', async () => {
  const { matchLane } = await load();
  const shifted = edge({ z: 2.4, id: 1 });
  const onLine = edge({ id: 2 });
  const match = matchLane([shifted, onLine], { x: 20, z: 3, tx: 1, tz: 0, half: 2.2, halfWidth: 0.9 });
  assert.equal(match.edge, onLine);
});

test('lane curves are rebuilt lazily from plain cloned worker data and cached per lane pair', async () => {
  const { hydrateRoadNetwork } = await load();
  const a = edge({ id: 0 });
  const b = edge({ id: 1, x: 100, z: -8, dx: 0, dz: -1, len: 60 });
  const data = JSON.parse(JSON.stringify({ nodes: [], edges: [a, b] }));
  const network = hydrateRoadNetwork({ nodes: data.nodes, edges: data.edges });
  assert.equal(network.connector(data.edges[0], 0, data.edges[1], 1), network.connector(data.edges[0], 0, data.edges[1], 1));
  const curve = network.connector(data.edges[0], 0, data.edges[1], 1);
  assert.ok(curve.len > 0);
  const point = { x: 0, z: 0, dx: 0, dz: 0 };
  const start = network.curvePoint(curve, 0, point);
  const startX = start.x;
  const startZ = start.z;
  assert.ok(Math.hypot(startX - (a.sx + a.dx * a.len + a.rx * a.lanes[0]), startZ - (a.sz + a.dz * a.len + a.rz * a.lanes[0])) < 1e-5);
});

test('ground queries bound lanes by curbs, obstacles, land coverage and sidewalk identity', async () => {
  const { createGroundQueries } = await load();
  const queries = createGroundQueries([{ minX: -5, maxX: 5, minZ: -5, maxZ: 5 }],
    [{ minX: 10, maxX: 14, minZ: -2, maxZ: 2 }], { coverage: [[-100, -100, 100, 100]] });
  assert.equal(queries.onSidewalk(0, 0), true);
  assert.equal(queries.onSidewalk(20, 0), false);
  assert.equal(queries.walkable(-1, 1, -1, 1), true, 'curb islands are walkable ground');
  assert.equal(queries.walkable(11, 13, -1, 1), false, 'obstacles block walking');
  assert.equal(queries.blocked(-1, 1, -1, 1), true, 'a curb blocks the roadway');
  assert.equal(queries.blocked(19, 21, 4, 6), false);
  assert.equal(queries.isRoadClear(20, 5), true);
  assert.equal(queries.isRoadClear(12, 0), false, 'an obstacle keeps lanes clear');
  assert.equal(queries.isRoadClear(0, 0), false, 'a curb keeps lanes clear');
  const outside = createGroundQueries([], [], { coverage: [[0, 0, 10, 10]] });
  assert.equal(outside.isRoadClear(50, 50), false);
});

function flatRing(x0, z0, x1, z1) {
  return [x0, z0, x1, z0, x1, z1, x0, z1];
}

test('resident block lookup answers only mounted tile curb islands and rebuilds on eviction', async () => {
  const { createResidentBlockLookup } = await load();
  let geometry = new Map([['k0j-1', { core: [[-500, 1450, -400, 1550]], blocks: [[flatRing(-500, 1450, -450, 1500), [], 0, '', 0, 0]] }]]);
  const tileWorld = { residentGeometry: () => geometry };
  const lookup = createResidentBlockLookup(tileWorld);
  assert.equal(lookup.count(), 1);
  const block = lookup.blockAt(-475, 1475);
  assert.ok(block);
  assert.equal(lookup.blockAt(-300, 1475), null);
  assert.equal(lookup.blockAt(-475, 1400), null);
  geometry = new Map();
  lookup.rebuild();
  assert.equal(lookup.count(), 0);
  assert.equal(lookup.blockAt(-475, 1475), null, 'evicted tile blocks are gone');
});

test('the resident service snapshot keeps only routable source data and forgets evicted tiles', async () => {
  const { createResidentRoadService } = await load();
  const features = {
    ways: [{ id: 1, nodes: [[10, 0, 0], [11, 1, 0]], tags: { highway: 'residential', name: 'Calle', amenity: 'bench', width: '9' } }],
    trees: [{ id: 99 }],
    signals: [{ id: 11, x: 1, z: 0 }]
  };
  let geometry = new Map([['k3j0', { core: [[1408.7, 454.6, 2158.7, 1454.6]],
    blocks: [[flatRing(1410, 460, 1500, 550), [], 0, '', 0, 0]] }]]);
  const tileWorld = {
    residentGeometry: () => geometry,
    residentStreetFeatures: () => new Map([['fase2', features], ['k3j0', features]])
  };
  const manifest = { grid: { seed: 'fase2' }, tiles: [{ id: 'fase2', core: [[-1841.3, -1145.4, 1408.7, 1454.6]] }] };
  const service = createResidentRoadService({ tileWorld, manifest, seedSidewalks: [{ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }],
    onNetwork: () => {}, debounceMs: 1e6 });
  try {
    const before = service.snapshot();
    assert.equal(before.featureSets.length, 2);
    assert.deepEqual(Object.keys(before.featureSets[0].ways[0].tags).sort(), ['highway', 'name', 'width']);
    assert.equal(before.featureSets[0].trees, undefined, 'trees never cross the worker boundary');
    assert.equal(before.featureSets[0].signals.length, 1);
    assert.deepEqual(before.coverage[0], [-1841.3, -1145.4, 1408.7, 1454.6]);
    assert.equal(before.sidewalks.length, 2, 'seed curb plus the mounted block island');
    assert.deepEqual(before.sidewalks[1], { minX: 1410, maxX: 1500, minZ: 460, maxZ: 550 });

    geometry = new Map();
    tileWorld.residentStreetFeatures = () => new Map([['fase2', features]]);
    const after = service.snapshot();
    assert.equal(after.featureSets.length, 1, 'the evicted tile no longer feeds the graph');
    assert.deepEqual(after.coverage, [[-1841.3, -1145.4, 1408.7, 1454.6]]);
    assert.equal(after.sidewalks.length, 1);
  } finally {
    service.dispose();
  }
});

test('the worker payload round-trips connectivity through flat index-addressed data', async () => {
  const { buildResidentRoadGraph } = await import('../js/madrid-resident-road-graph.js');
  const { buildRoadNetwork, encodeRoadNetwork, decodeRoadNetwork } = await load();
  const way = (id, nodes, tags = {}) => ({ id, nodes, tags: { highway: 'residential', name: 'Calle', ...tags } });
  const features = { ways: [
    way(1, [[1, 3000, 0], [2, 3200, 0]]), way(2, [[2, 3200, 0], [3, 3200, 200]]),
    way(3, [[3, 3200, 200], [4, 3000, 200]]), way(4, [[4, 3000, 200], [1, 3000, 0]]),
    way(5, [[5, 3100, -100], [6, 3100, 300]])
  ], signals: [{ id: 2, x: 3200, z: 0 }] };
  const graph = buildResidentRoadGraph([features]);
  const original = buildRoadNetwork([], [], [], { roadGraph: graph, coverage: [[2950, -150, 3250, 350]], sourceOnly: true });
  assert.ok(original.edges.length >= 4);
  assert.ok(original.nodes.some((n) => n.signal), 'the source traffic signal survives the round trip');

  const encoded = encodeRoadNetwork(original);
  const cloned = JSON.parse(JSON.stringify(encoded)); // acyclic plain data, unlike the live graph
  assert.equal(typeof cloned.nodes[0].arms[0].lead, 'number');
  const queries = { walkable: () => true, onSidewalk: () => false, isRoadClear: () => true };
  const decoded = decodeRoadNetwork({ ...cloned, ...queries });

  assert.equal(decoded.nodes.length, original.nodes.length);
  assert.equal(decoded.edges.length, original.edges.length);
  assert.equal(decoded.edges.filter((e) => e.moves.length).length, original.edges.filter((e) => e.moves.length).length);
  assert.equal(decoded.edges.filter((e) => e.opposite).length, original.edges.filter((e) => e.opposite).length);
  for (const [i, edge] of decoded.edges.entries()) {
    const source = original.edges[i];
    assert.equal(edge.from, decoded.nodes[source.from.id]);
    assert.equal(edge.to, decoded.nodes[source.to.id]);
    assert.equal(edge.inArm, edge.to.arms[source.to.arms.indexOf(source.inArm)]);
    assert.equal(edge.outArm, edge.from.arms[source.from.arms.indexOf(source.outArm)]);
    assert.equal(edge.opposite, source.opposite ? decoded.edges[source.opposite.id] : null);
    for (const move of edge.moves) assert.ok(decoded.edges.includes(move.to));
    assert.deepEqual(edge.lanes, source.lanes);
  }
  for (const node of decoded.nodes) {
    for (const arm of node.arms) assert.ok(node.arms.includes(arm.lead), 'every arm lead is one of the node arms');
  }
  const sourceWithMoves = original.edges.find((e) => e.moves.length);
  const decodedWithMoves = decoded.edges[sourceWithMoves.id];
  const sMove = sourceWithMoves.moves[0];
  const dMove = decodedWithMoves.moves[0];
  assert.equal(dMove.turn, sMove.turn);
  assert.equal(dMove.to, decoded.edges[sMove.to.id]);
  assert.equal(decoded.connector(decodedWithMoves, 0, dMove.to, dMove.out[0]).len > 0, true);
});
test('a swap reports its own per-phase timings, not just the worker numbers', async () => {
  const { buildResidentRoadGraph } = await import('../js/madrid-resident-road-graph.js');
  const { buildRoadNetwork, encodeRoadNetwork, createResidentRoadService } = await load();
  const way = (id, nodes) => ({ id, nodes, tags: { highway: 'residential', name: 'Calle' } });
  const features = { ways: [way(1, [[1, 200, 0], [2, 400, 0]]), way(2, [[2, 400, 0], [3, 400, 200]]), way(3, [[3, 400, 200], [4, 200, 200]]), way(4, [[4, 200, 200], [1, 200, 0]]), way(5, [[5, 300, -100], [6, 300, 300]])] };
  const graph = buildResidentRoadGraph([features]);
  const encoded = encodeRoadNetwork(buildRoadNetwork([], [], [], { roadGraph: graph, coverage: [[150, -150, 450, 350]], sourceOnly: true }));
  const tileWorld = { residentGeometry: () => new Map(), residentStreetFeatures: () => new Map([['fase2', features]]) };
  const manifest = { grid: { seed: 'fase2' }, tiles: [{ id: 'fase2', core: [[-1841, -1145, 1408, 1454]] }] };
  let captured = null;
  const service = createResidentRoadService({ tileWorld, manifest, seedSidewalks: [],
    onNetwork: (_network, _blockAt, stats) => { captured = stats; }, debounceMs: 1e6 });
  try {
    service.apply(encoded, service.snapshot(), { snapshotMs: 2.5, workerMs: 11 });
  } finally {
    service.dispose();
  }
  assert.ok(captured, 'the swap reached onNetwork');
  assert.equal(captured.timings.snapshotMs, 2.5);
  assert.equal(captured.timings.workerMs, 11);
  for (const key of ['applyMs', 'queriesMs', 'decodeMs', 'blockLookupMs']) {
    assert.equal(typeof captured.timings[key], 'number', key + ' is timed');
    assert.ok(captured.timings[key] >= 0, key + ' cannot be negative');
  }
});


