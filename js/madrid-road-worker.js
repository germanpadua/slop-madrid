import { prepareResidentRoadNetwork } from './madrid-road-prepare-data.js';

self.onmessage = ({ data }) => {
  try {
    const result = prepareResidentRoadNetwork(data);
    self.postMessage({ requestId: data.requestId, ...result, stats: { ...result.stats, mode: 'worker' } });
  } catch (error) {
    self.postMessage({ requestId: data.requestId, error: error?.message || String(error) });
  }
};
