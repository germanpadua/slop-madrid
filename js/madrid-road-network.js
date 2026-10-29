// Resident circulation service: assembles the source street features of every mounted tile plus
// the seed, asks the road worker for the routing graph and swaps it into the live traffic system.
// Requests are versioned and debounced: a burst of tile loads/unloads produces one build, and an
// answer that no longer matches the resident set is discarded instead of resurrecting evicted roads.
import { blockAt as seedBlockAt } from './city-config.js';
import { createGroundQueries, decodeRoadNetwork } from './road-network.js';
import { createRoadNetworkPreparer } from './madrid-road-preparer.js';

// Only the tags the circulation policy reads cross the worker boundary; trees and other street
// features stay in their own renderer instead of being copied with every rebuild.
const ROAD_TAGS = ['highway', 'name', 'access', 'motor_vehicle', 'vehicle', 'oneway', 'junction', 'width', 'lanes', 'bridge', 'tunnel', 'layer'];
const slimCache = new WeakMap();
function slimFeatures(data) {
  if (!data) return null;
  let slim = slimCache.get(data);
  if (slim) return slim;
  const tags = (source) => {
    const out = {};
    for (const key of ROAD_TAGS) if (source && source[key] !== undefined) out[key] = source[key];
    return out;
  };
  slim = {
    ways: (data.ways || []).map((way) => ({ id: way.id, nodes: way.nodes, tags: tags(way.tags) })),
    signals: data.signals || []
  };
  slimCache.set(data, slim);
  return slim;
}

function flatBounds(flat) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const x = flat[i], z = flat[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return minX <= maxX ? [minX, maxX, minZ, maxZ] : null;
}

// Curb islands of the mounted tiles, for pedestrians. The seed keeps city-config's own lookup; this
// one answers only outside it, so the two together cover every resident sidewalk.
export function createResidentBlockLookup(tileWorld) {
  const CELL = 64;
  const grid = new Map();
  let blocks = [];
  function build() {
    grid.clear();
    blocks = [];
    for (const tile of tileWorld.residentGeometry().values()) {
      for (const raw of tile.blocks || []) {
        const flat = raw && raw[0];
        if (!flat || flat.length < 6) continue;
        const poly = [];
        for (let i = 0; i + 1 < flat.length; i += 2) poly.push({ x: flat[i], z: flat[i + 1] });
        const bounds = flatBounds(flat);
        if (!bounds || poly.length < 3) continue;
        const block = { id: `${tile.id}:${blocks.length}`, poly, minX: bounds[0], maxX: bounds[1], minZ: bounds[2], maxZ: bounds[3], rect: false, park: 0 };
        blocks.push(block);
        for (let ix = Math.floor(block.minX / CELL); ix <= Math.floor(block.maxX / CELL); ix++) {
          for (let iz = Math.floor(block.minZ / CELL); iz <= Math.floor(block.maxZ / CELL); iz++) {
            const key = `${ix}:${iz}`;
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key).push(block);
          }
        }
      }
    }
  }
  function inside(block, x, z) {
    let hit = false;
    const poly = block.poly;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
    }
    return hit;
  }
  function blockAt(x, z) {
    const list = grid.get(`${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`);
    if (!list) return null;
    for (const block of list) {
      if (x < block.minX || x > block.maxX || z < block.minZ || z > block.maxZ) continue;
      if (inside(block, x, z)) return block;
    }
    return null;
  }
  build();
  return { blockAt, rebuild: build, count: () => blocks.length };
}

export function createResidentRoadService({ tileWorld, manifest, seedSidewalks = [], seedObstacles = [],
  onNetwork, onError = () => {}, debounceMs = 320 }) {
  const preparer = createRoadNetworkPreparer();
  const seedTile = manifest && manifest.tiles && manifest.tiles.find
    ? manifest.tiles.find((tile) => tile.id === ((manifest.grid && manifest.grid.seed) || 'fase2'))
    : null;
  const seedCore = (seedTile && seedTile.core) || [];
  let version = 0;
  let timer = null;
  let inFlight = false;
  let disposed = false;

  function snapshot() {
    const featureSets = [];
    for (const data of tileWorld.residentStreetFeatures().values()) {
      const slim = slimFeatures(data);
      if (slim) featureSets.push(slim);
    }
    const coverage = [...seedCore];
    const sidewalks = seedSidewalks.slice();
    for (const tile of tileWorld.residentGeometry().values()) {
      if (tile.core) coverage.push(...tile.core);
      for (const raw of tile.blocks || []) {
        const flat = raw && raw[0];
        if (!flat) continue;
        const bounds = flatBounds(flat);
        if (bounds) sidewalks.push({ minX: bounds[0], maxX: bounds[1], minZ: bounds[2], maxZ: bounds[3] });
      }
    }
    return { featureSets, sidewalks, obstacles: seedObstacles, coverage };
  }

  function apply(result, inputs, timings = {}) {
    // The worker ships plain connectivity; the runtime functions (lane curves, ground queries) are
    // rebuilt here from the exact same input snapshot, so both halves describe one network.
    // Per-phase timings land in roadStats so the cost of a swap can be watched without a profiler.
    const tQueries = performance.now();
    const queries = createGroundQueries(inputs.sidewalks, inputs.obstacles, { coverage: inputs.coverage });
    const tDecode = performance.now();
    const network = decodeRoadNetwork({
      nodes: result.nodes, edges: result.edges, paintEdges: result.paintEdges,
      walkable: queries.walkable, onSidewalk: queries.onSidewalk, isRoadClear: queries.isRoadClear
    });
    const tBlocks = performance.now();
    const residentBlocks = createResidentBlockLookup(tileWorld);
    const blockAt = (x, z) => seedBlockAt(x, z) || residentBlocks.blockAt(x, z);
    const applyMs = performance.now() - tQueries;
    onNetwork(network, blockAt, {
      ...result.stats,
      timings: {
        ...result.stats?.timings,
        snapshotMs: timings.snapshotMs,
        workerMs: timings.workerMs,
        applyMs: +applyMs.toFixed(1),
        queriesMs: +(tDecode - tQueries).toFixed(1),
        decodeMs: +(tBlocks - tDecode).toFixed(1),
        blockLookupMs: +(performance.now() - tBlocks).toFixed(1)
      }
    }, residentBlocks.count());
  }

  function schedule() {
    if (disposed) return;
    version++;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, debounceMs);
  }

  async function run() {
    timer = null;
    if (disposed) return;
    if (inFlight) { timer = setTimeout(run, debounceMs); return; }
    inFlight = true;
    const requestVersion = version;
    let inputs;
    let result;
    let snapshotMs;
    let workerMs;
    try {
      const tSnapshot = performance.now();
      inputs = snapshot();
      snapshotMs = performance.now() - tSnapshot;
      // Curbs are for walking and painting, not for laying lanes: the source graph already carries
      // real road widths, and blocking lanes against coarse curb rectangles collapses the graph.
      const tWorker = performance.now();
      result = await preparer.prepare({ featureSets: inputs.featureSets, sidewalks: [], obstacles: [], coverage: inputs.coverage });
      workerMs = performance.now() - tWorker;
    } catch (error) {
      inFlight = false;
      if (!disposed) onError(error);
      return;
    }
    inFlight = false;
    if (disposed) return;
    if (requestVersion !== version) { timer = setTimeout(run, debounceMs); return; }
    apply(result, inputs, { snapshotMs: +snapshotMs.toFixed(1), workerMs: +workerMs.toFixed(1) });
  }

  schedule();
  return {
    schedule,
    apply, // exposed for tests: apply a worker-shaped result to the current snapshot
    snapshot,
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      preparer.dispose();
    }
  };
}
