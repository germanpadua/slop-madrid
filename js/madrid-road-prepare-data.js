import { buildResidentRoadGraph } from './madrid-resident-road-graph.js';
import { buildRoadNetwork, encodeRoadNetwork } from './road-network.js';

// Shared preparation; fallback runs synchronously on main and can stall a frame.
export function prepareResidentRoadNetwork({ featureSets, sidewalks = [], obstacles = [], coverage }) {
  const start = performance.now();
  const graph = buildResidentRoadGraph(featureSets);
  const assembled = performance.now();
  // road-network logs the centreline summary; it would be one line per tile batch.
  const log = console.info;
  console.info = () => {};
  let network;
  try {
    network = buildRoadNetwork(sidewalks, obstacles, [], { roadGraph: graph, sourceOnly: true, coverage });
  } finally {
    console.info = log;
  }
  return {
    ...encodeRoadNetwork(network),
    stats: {
      graphNodes: graph.nodes.length / 2,
      graphLinks: graph.links.length,
      graphSignals: graph.signals.length,
      routingNodes: network.nodes.length,
      routingEdges: network.edges.length,
      assembledMs: Math.round(assembled - start),
      layoutMs: Math.round(performance.now() - assembled)
    }
  };
}
