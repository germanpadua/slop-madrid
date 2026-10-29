// Circulation network worker: assembles the resident road graph from the source street
// features and lays out lanes away from the animation thread. Returns graph connectivity
// (nodes/edges, which are plain data) but no functions: the main thread rehydrates the
// lane-curve runtime and its own ground queries from the same inputs.
import { buildResidentRoadGraph } from './madrid-resident-road-graph.js';
import { buildRoadNetwork, encodeRoadNetwork } from './road-network.js';

self.onmessage = ({ data }) => {
  const { requestId, featureSets, sidewalks, obstacles, coverage } = data;
  const start = performance.now();
  try {
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
    self.postMessage({
      requestId,
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
    });
  } catch (error) {
    self.postMessage({ requestId, error: error && error.message ? error.message : String(error) });
  }
};
