// One reusable worker keeps geometry analysis away from input and animation.
export function createTilePreparer({ distanceGeometry = false } = {}) {
  let worker = null;
  let nextId = 0;
  const requests = new Map();
  const stop = (error) => {
    worker?.terminate();
    worker = null;
    for (const request of requests.values()) request.reject(error);
    requests.clear();
  };
  return {
    async prepare(tile) {
      if (typeof Worker === 'undefined') return tile;
      if (!worker) {
        worker = new Worker(new URL('./madrid-tile-worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => {
          const request = requests.get(data.requestId);
          if (!request) return;
          requests.delete(data.requestId);
          if (data.error) request.reject(new Error(data.error));
          else request.resolve({ ...request.tile, prepared: data.prepared, workerMs: data.workerMs });
        };
        worker.onerror = (event) => stop(new Error(event.message || 'Tile preparation worker failed'));
      }
      return new Promise((resolve, reject) => {
        const requestId = ++nextId;
        requests.set(requestId, { tile, resolve, reject });
        try { worker.postMessage({ requestId, tile: { parcels: tile.parcels, distanceGeometry } }); }
        catch (error) { requests.delete(requestId); reject(error); }
      });
    },
    dispose() { stop(new Error('Tile preparation disposed')); }
  };
}
