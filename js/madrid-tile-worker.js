import { prepareTile } from './madrid-tile-preparation.js';
self.onmessage = ({ data: { requestId, tile } }) => {
  try {
    const start = performance.now();
    const prepared = prepareTile(tile);
    const fb = prepared.farBuildings;
    const transfer = fb && fb.positions && fb.normals && fb.colors && fb.indices
      ? [fb.positions.buffer, fb.normals.buffer, fb.colors.buffer, fb.indices.buffer] : [];
    self.postMessage({ requestId, prepared, workerMs: performance.now() - start }, transfer);
  } catch (error) {
    self.postMessage({ requestId, error: error.message });
  }
};
