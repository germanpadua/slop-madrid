// Reuse a Module Worker, with the same source graph preparation on main if it cannot run.
export function createRoadNetworkPreparer() {
  let worker = null;
  let nextId = 0;
  let fallback = typeof Worker === 'undefined';
  let disposed = false;
  const requests = new Map();
  const prepareOnMain = async (input) => {
    const { prepareResidentRoadNetwork } = await import('./madrid-road-prepare-data.js');
    if (disposed) throw new Error('Road network preparation disposed');
    const result = prepareResidentRoadNetwork(input);
    return { ...result, stats: { ...result.stats, mode: 'main-fallback' } };
  };
  const useFallback = () => {
    fallback = true;
    worker?.terminate();
    worker = null;
    for (const request of requests.values()) prepareOnMain(request.input).then(request.resolve, request.reject);
    requests.clear();
  };
  return {
    prepare(input) {
      if (disposed) return Promise.reject(new Error('Road network preparation disposed'));
      if (fallback) return prepareOnMain(input);
      if (!worker) {
        try {
          worker = new Worker(new URL('./madrid-road-worker.js', import.meta.url), { type: 'module' });
          worker.onmessage = ({ data }) => {
            const request = requests.get(data.requestId);
            if (!request) return;
            requests.delete(data.requestId);
            if (data.error) request.reject(new Error(data.error));
            else request.resolve({ nodes: data.nodes, edges: data.edges, paintEdges: data.paintEdges, stats: data.stats });
          };
          worker.onerror = (event) => { event.preventDefault?.(); useFallback(); };
          worker.onmessageerror = useFallback;
        } catch {
          useFallback();
          return prepareOnMain(input);
        }
      }
      return new Promise((resolve, reject) => {
        const requestId = ++nextId;
        requests.set(requestId, { resolve, reject, input });
        try { worker.postMessage({ requestId, ...input }); }
        catch { useFallback(); }
      });
    },
    dispose() {
      disposed = true;
      worker?.terminate();
      worker = null;
      for (const request of requests.values()) request.reject(new Error('Road network preparation disposed'));
      requests.clear();
    }
  };
}
