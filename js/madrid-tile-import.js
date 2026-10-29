// A short-lived worker owns the ES module cache. Termination releases its parsed module after structured cloning.
// Mesh construction remains on the main thread. URLs retain the manifest's ?v=<md5> cache key.
export function importTileModule(url, { signal, WorkerClass = globalThis.Worker, timeoutMs = 30000 } = {}) {
  if (!WorkerClass) return import(url); // Node/data tools; browsers use a module worker.
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Tile cancelled', 'AbortError')); return; }
    const worker = new WorkerClass(new URL('./madrid-tile-worker.js', import.meta.url), { type: 'module' });
    let timer;
    const finish = (error, result) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new DOMException('Tile cancelled', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => data.error ? finish(new Error(data.error)) : finish(null, { TILE: data.tile });
    worker.onerror = (event) => { event.preventDefault?.(); finish(new Error(event.message || 'Tile worker failed')); };
    timer = setTimeout(() => finish(new Error('Tile worker timed out')), timeoutMs);
    worker.postMessage({ url });
  });
}
