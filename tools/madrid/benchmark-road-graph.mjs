// Topology/lane-layout CPU benchmark. No render, obstacles or sidewalk collision
// data: this is a lower-bound preparation cost, not runtime/FPS validation.
import fs from 'node:fs';
import { buildResidentRoadGraph } from '../../js/madrid-resident-road-graph.js';
import { buildRoadNetwork } from '../../js/road-network.js';
const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('tools/madrid/tiles.json', root)));
const selected = process.argv[2]?.split(',');
const tiles = manifest.tiles.filter(t => t.status === 'ready' && (!selected || selected.includes(t.id)));
const features = [];
for (const tile of tiles) {
  const module = await import(new URL(tile.module, root));
  features.push((module.GEO || module.TILE).streetFeatures);
}
const start = performance.now();
const graph = buildResidentRoadGraph(features);
const assembled = performance.now();
const info = console.info;
let network;
try {
  console.info = (...args) => process.stderr.write(args.join(' ') + '\n');
  network = buildRoadNetwork([], [], [], { roadGraph: graph, sourceOnly: true, coverage: tiles.flatMap(t => t.core) });
} finally { console.info = info; }
console.log(JSON.stringify({ tiles: tiles.map(t => t.id), obstacles: 0, sidewalks: 0,
  graphNodes: graph.nodes.length / 2, graphLinks: graph.links.length, sourceSignals: graph.signals.length,
  routingNodes: network.nodes.length, routingEdges: network.edges.length,
  assembleMs: assembled - start, laneLayoutMs: performance.now() - assembled }, null, 2));
