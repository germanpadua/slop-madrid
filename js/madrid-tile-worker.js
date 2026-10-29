// Import/parse off the render thread; no eval or giant JSON response on the main thread.
self.onmessage = async ({ data: { url } }) => {
  try {
    const { TILE } = await import(url);
    if (!TILE) throw new Error('Tile module has no TILE export');
    self.postMessage({ tile: TILE });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
