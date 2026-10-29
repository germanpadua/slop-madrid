// One reusable worker prepares the resident circulation network off the animation thread.
// Requests carry a caller version; the caller discards answers that no longer match the scene.
export function createRoadNetworkPreparer() {
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
    prepare(input) {
      if (typeof Worker === 'undefined') return Promise.reject(new Error('Worker is unavailable'));
      if (!worker) {
        worker = new Worker(new URL('./madrid-road-worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => {
          const request = requests.get(data.requestId);
          if (!request) return;
          requests.delete(data.requestId);
          if (data.error) request.reject(new Error(data.error));
          else request.resolve({ nodes: data.nodes, edges: data.edges, stats: data.stats });
        };
        worker.onerror = (event) => stop(new Error(event.message || 'Road network worker failed'));
      }
      return new Promise((resolve, reject) => {
        const requestId = ++nextId;
        requests.set(requestId, { resolve, reject });
        try { worker.postMessage({ requestId, ...input }); }
        catch (error) { requests.delete(requestId); reject(error); }
      });
    },
    dispose() { stop(new Error('Road network preparation disposed')); }
  };
}
