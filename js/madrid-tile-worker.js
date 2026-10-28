import { prepareTile } from './madrid-tile-preparation.js';
self.onmessage = ({ data: { requestId, tile } }) => {
  try {
    const start = performance.now();
    const prepared = prepareTile(tile);
    self.postMessage({ requestId, prepared, workerMs: performance.now() - start });
  } catch (error) {
    self.postMessage({ requestId, error: error.message });
  }
};
