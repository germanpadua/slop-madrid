import { prepareTile } from './madrid-tile-preparation.js';
self.onmessage = ({ data: { requestId, tile } }) => {
  try {
    const start = performance.now();
    const prepared = prepareTile(tile);
    const transfer = prepared.farBuildings
      ? [prepared.farBuildings.positions.buffer, prepared.farBuildings.normals.buffer, prepared.farBuildings.colors.buffer, prepared.farBuildings.indices.buffer] : [];
    self.postMessage({ requestId, prepared, workerMs: performance.now() - start }, transfer);
  } catch (error) {
    self.postMessage({ requestId, error: error.message });
  }
};
