// tools/madrid/measure.mjs — phase-3 load-time / streaming / frame-cost measurement in headless Chromium.
//
// Serves the repo (the same static tree GitHub Pages deploys), boots the app with ?debug (it exposes
// window.__madrid), reads the [init] phase timings, then walks the camera across the phase-3 tiles and reports the
// per-tile import+build time, the resident geodata, and the renderer's frame cost.
//
// The WebGPU adapter in headless is SwiftShader (software raster): its FPS is not a GPU measurement and is only
// reported as the render-loop rate; draw calls & triangles are the comparable numbers.
//
// usage: node tools/madrid/measure.mjs [--tiles k3j1,k4j1,...] [--native-gpu]
//        node tools/madrid/measure.mjs --cpu [--baseline-ref feat/monumentos]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cpuOnly = process.argv.includes('--cpu');
const nativeGpu = process.argv.includes('--native-gpu');
const baselineIndex = process.argv.indexOf('--baseline-ref');
const baselineRef = baselineIndex >= 0 ? process.argv[baselineIndex + 1] : null;
const baselineWorld = baselineRef ? execFileSync('git', ['show', `${baselineRef}:js/madrid-tile-world.js`], { cwd: ROOT, encoding: 'utf8' }) : null;
const PW = process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.js';
const pwMod = await import(PW);
const chromium = pwMod.chromium || pwMod.default?.chromium;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/js/__baseline-world.js' && baselineWorld) {
    res.writeHead(200, { 'content-type': 'text/javascript' }).end(baselineWorld);
    return;
  }
  if (url === '/__cpu') {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><meta charset="utf-8">${html.match(/<script type="importmap">[\s\S]*?<\/script>/)[0]}`);
    return;
  }
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const args = process.argv.slice(2);
const tileArg = args.indexOf('--tiles');
const walk = tileArg >= 0 ? args[tileArg + 1].split(',') : ['k3j1', 'k4j1', 'k4j2', 'k2j-1', 'k0j-1', 'k0j3', 'k2j4'];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined, // e.g. /usr/bin/google-chrome when no bundled chromium
  args: cpuOnly ? ['--disable-gpu'] : nativeGpu ? [] : ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--enable-webgpu-developer-features']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
const pageErrors = [];
const failed = [];
page.on('console', (m) => logs.push(m.text()));
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));

if (cpuOnly) {
  try {
    await page.goto(`http://127.0.0.1:${port}/__cpu`);
    const result = await page.evaluate(async ({ baselineRef }) => {
      const t0 = performance.now();
      const THREE = await import('three/webgpu');
      const { createTileWorld } = await import(baselineRef ? '/js/__baseline-world.js' : '/js/madrid-tile-world.js');
      const { createParcelRoofGeometry } = await import('/js/madrid-parcel-geometry.js');
      const { createTileStreamer } = await import('/js/madrid-tiles.js');
      const { createActiveMadridData } = await import('/js/madrid-active-data.js');
      const { GEO } = await import('/js/madrid-geodata.js');
      const config = await import('/js/city-config.js');
      const { NYCMapSystem } = await import('/js/nyc-map.js');
      const mf = await (await fetch('/tools/madrid/tiles.json')).json();
      const seed = mf.tiles.find((t) => t.id === 'fase2');
      const model = createActiveMadridData({ ...GEO, core: seed.core });
      const scene = new THREE.Scene(), world = createTileWorld(scene);
      const importMs = performance.now() - t0;
      const tileTimes = [];
      const streamer = await createTileStreamer({ world, baseUrl: location.origin + '/',
        manifestUrl: '/tools/madrid/tiles.json', onTileAdded: (tile) => model.set(tile), onTileRemoved: (id) => model.remove(id) });
      let peakBytes = 0, peakTiles = 0, peakBuffers = 0;
      const bufferBytes = () => {
        let bytes = 0;
        const seen = new Set();
        scene.traverse((o) => {
          if (!o.geometry || seen.has(o.geometry)) return;
          seen.add(o.geometry);
          for (const a of Object.values(o.geometry.attributes)) bytes += a.array.byteLength;
          bytes += o.geometry.index?.array.byteLength || 0;
          bytes += o.instanceMatrix?.array.byteLength || 0;
        });
        return bytes;
      };
      const samples = mf.tiles.filter((t) => t.status === 'ready' && t.id !== 'fase2');
      for (const tile of samples) {
        // Serial imports/builds, same worker, same admission path as app. Keep cap, explicitly evict before full.
        if (streamer.loaded.size >= mf.budget.maxResidentTiles) streamer.dropTile([...streamer.loaded.keys()].find((id) => id !== 'fase2'));
        const start = performance.now();
        const ok = await streamer.loadTile(tile.id);
        const graphStart = performance.now();
        const graph = model.snapshot().roadGraph;
        const graphMs = performance.now() - graphStart;
        tileTimes.push({ id: tile.id, bytes: tile.bytes, ok, importBuildMs: +(graphStart - start).toFixed(1), graphMs: +graphMs.toFixed(1), graphLinks: graph.links.length });
        peakBytes = Math.max(peakBytes, streamer.status().bytes);
        peakTiles = Math.max(peakTiles, streamer.loaded.size);
        peakBuffers = Math.max(peakBuffers, bufferBytes());
      }
      // Exercise real Path2D/map construction and live lookups in Chromium, without a WebGPU device.
      config.setActiveMadridData(model);
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      const map = new NYCMapSystem({ controllerManager: { getActiveEntity: () => ({ position: { x: 1700, z: -1500 }, heading: 0 }) } });
      Object.assign(map, { fullCanvas: canvas, fullCtx: canvas.getContext('2d'), isFullMapOpen: true,
        viewCenterX: 1700, viewCenterZ: -1500, viewZoom: 0.3 });
      map.setActiveData(model); map.renderFullMap();
      const mapSmoke = { residentTiles: model.tiles.size, roadCount: config.ROADS.length, blockCount: config.BLOCKS.length };
      // Verify the actual renderer's concave footprint, rather than just inspecting its source code.
      streamer.dispose();
      config.setActiveMadridData(model); map.setActiveData(model); map.renderFullMap();
      mapSmoke.afterDisposal = { residentTiles: model.tiles.size, roadCount: config.ROADS.length, blockCount: config.BLOCKS.length };
      const remainingMeshes = world.meshCount();
      world.addTile({ id: 'probe', core: [[0, 0, 100, 50]], blocks: [],
        parcels: [{ ring: [5, 5, 25, 5, 25, 10, 10, 10, 10, 25, 5, 25], h: 12 },
          { ring: [30, 5, 45, 5, 45, 25, 30, 25], holes: [[34, 9, 41, 9, 41, 21, 34, 21]], h: 12 },
          { ring: [50, 5, 65, 5, 65, 25, 50, 25], h: 20 },
          { ring: [65, 5, 80, 5, 80, 25, 65, 25], h: 12 }] });
      scene.updateMatrixWorld(true);
      const heightAt = (x, z) => {
        const r = new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
        return r.intersectObjects(scene.children, true)[0]?.point.y;
      };
      const geometryChecks = { roofHeight: heightAt(7, 7), emptyPatioHeight: heightAt(20, 20), innerCourtyardHeight: heightAt(37, 15) };
      geometryChecks.partyWallVertices = 0;
      scene.traverse((o) => {
        const kind = o.geometry?.getAttribute('facadeKind');
        const pos = o.geometry?.getAttribute('position');
        if (!kind) return;
        for (let i = 0; i < kind.count; i++) if (kind.getX(i) === 3) {
          if (Math.abs(pos.getX(i) - 65) > 0.01 || pos.getY(i) < 12) throw new Error('Party wall escaped its contour edge/height');
          geometryChecks.partyWallVertices++;
        }
      });
      world.disposeAll();
      if (!baselineRef && (!(geometryChecks.roofHeight >= 12 && geometryChecks.roofHeight <= 16.2) || Math.abs(geometryChecks.emptyPatioHeight) > 0.01 ||
        Math.abs(geometryChecks.innerCourtyardHeight) > 0.01 || !geometryChecks.partyWallVertices)) throw new Error(`Footprint raycast failed: ${JSON.stringify(geometryChecks)}`);
      // Exercise BOTH slope templates directly, independent of the deterministic flat/hip/ring roll.
      geometryChecks.clippedRoofs = [];
      for (const kind of ['hip', 'ring']) {
        for (const rot of [0, Math.PI / 2]) {
          const flat = [0, 0, 40, 0, 40, 40, 0, 40], holes = [[5, 5, 12, 5, 12, 12, 5, 12]];
          const P = { x0: 0, x1: 40, z0: 0, z1: 40, w: 40, d: 40, h: 12 };
          const geo = createParcelRoofGeometry(flat, holes, P, { kind, rot, h: 3 });
          const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.updateMatrixWorld();
          const hit = (x, z) => new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh)[0]?.point.y;
          if (!(hit(3, 3) > 12) || hit(8, 8) !== undefined) throw new Error(`${kind} roof filled a sourced courtyard`);
          geo.dispose();
          const L = [0, 0, 40, 0, 40, 8, 8, 8, 8, 40, 0, 40];
          mesh.geometry = createParcelRoofGeometry(L, [], P, { kind, rot, h: 3 });
          if (!(hit(3, 3) > 12) || hit(25, 25) !== undefined) throw new Error(`${kind} roof filled a concave street/patio`);
          mesh.geometry.dispose(); mat.dispose();
          geometryChecks.clippedRoofs.push({ kind, rot, courtyardOpen: true, concavityOpen: true });
        }
      }
      if (remainingMeshes !== 0 || peakBytes > mf.budget.maxResidentBytes || peakTiles > mf.budget.maxResidentTiles) throw new Error('Resident budget/disposal failed');
      return { mode: 'cpu-no-renderer', baselineRef, importMs: +importMs.toFixed(1), tileTimes, peakBytes, peakTiles,
        peakGeometryBufferBytes: peakBuffers, remainingMeshes, geometryChecks, mapSmoke,
        note: 'No WebGPU renderer, no FPS. Geometry buffers exclude seed, textures, JS heap, driver allocations and shadow passes.' };
    }, { baselineRef });
    console.log(JSON.stringify({ ...result, runtime: { arch: process.arch, cpus: os.availableParallelism(), node: process.version,
      chromium: browser.version() }, pageErrors, failedRequests: failed }, null, 2));
  } finally {
    await browser.close(); server.close();
  }
  process.exit(0);
}

const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/?debug=1`, { waitUntil: 'load', timeout: 180000 });
// SwiftShader compiles the ~500 pipelines of the Madrid materials slowly: the loading screen can take several minutes
await page.waitForFunction(() => window.__madrid && window.__madrid.renderer && document.querySelector('#loading-overlay.hidden'), null, { timeout: 900000 });
const bootMs = Date.now() - t0;
const initLine = logs.find((l) => l.startsWith('[init]')) || '';

const result = await page.evaluate(async ({ walk }) => {
  const { renderer, tileStreamer, tileWorld, controllerManager } = window.__madrid;
  const waitFor = async (fn, timeoutMs = 120000) => {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      if (fn()) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };
  const before = tileStreamer ? tileStreamer.status() : null;
  const tileMs = [];
  const autoUpdate = tileStreamer?.update;
  // The app follows its camera every frame; keep it from cancelling the harness's next destination while it loads.
  if (tileStreamer) tileStreamer.update = () => null;
  if (tileStreamer) {
    for (const id of walk) {
      const tile = tileStreamer.tiles.find((t) => t.id === id);
      if (!tile) continue;
      const x = (tile.core[0][0] + tile.core[0][2]) / 2;
      const z = (tile.core[0][1] + tile.core[0][3]) / 2;
      const t = performance.now();
      autoUpdate(x, z, performance.now());
      const ok = await waitFor(() => tileStreamer.loaded.has(id), 90000);
      if (ok) controllerManager.teleportActiveTo(x, z, 0); // active ground must exist before resolving the landing
      tileMs.push({ id, ok, ms: Math.round(performance.now() - t) });
    }
  }
  // Force a 4-6 tile resident set around the Retiro cluster (the streaming policy still enforces the byte budget).
  if (tileStreamer) {
    tileStreamer.budget.preloadRadius = 5000;
    controllerManager.teleportActiveTo(1800, 0, 0);
    autoUpdate(1800, 0, performance.now());
    await waitFor(() => tileStreamer.status().loaded.length >= 6, 120000);
  }
  const tileSet = tileStreamer ? tileStreamer.status() : null;
  if (tileStreamer) tileStreamer.update = autoUpdate;
  const adapter = await navigator.gpu?.requestAdapter();
  const adapterInfo = adapter?.info ? Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter']
    .map((key) => [key, adapter.info[key]])) : null;
  // Frame cost: renderer.info.render.frame counts the frames the app actually submitted.
  const frames0 = renderer.info?.render?.frame ?? 0;
  const start = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const frames = (renderer.info?.render?.frame ?? 0) - frames0;
  const secs = (performance.now() - start) / 1000;
  const info = renderer.info?.render || {};
  // Per-tile geometry: deck slab height, instanced buildings and the tiles' collider count.
  const sceneOf = window.__madrid.scene;
  const tileStats = (tileWorld ? tileWorld.ids() : []).map((id) => {
    const g = sceneOf.getObjectByName(`MadridTile:${id}`);
    if (!g) return { id, missing: true };
    let meshes = 0, instances = 0, deckMinY = Infinity, deckMaxY = -Infinity;
    const kinds = new Set();
    g.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      kinds.add(o.name);
      if (o.isInstancedMesh) instances += o.count;
      if (o.name === 'TileDeck') {
        o.geometry.computeBoundingBox();
        deckMinY = Math.min(deckMinY, o.geometry.boundingBox.min.y);
        deckMaxY = Math.max(deckMaxY, o.geometry.boundingBox.max.y);
      }
    });
    return { id, meshes, instances, deckMinY, deckMaxY, colliders: g.userData.colliders?.length ?? 0, kinds: [...kinds] };
  });
  return {
    tileStats,
    tiles: before,
    after: tileSet,
    tileMs,
    fps: frames / secs,
    frames,
    drawCalls: info.drawCalls ?? info.calls ?? null,
    triangles: info.triangles ?? null,
    residentBytes: tileWorld ? tileWorld.residentBytes() : 0,
    meshes: tileWorld ? tileWorld.meshCount() : 0,
    loaded: tileWorld ? tileWorld.ids() : [],
    adapterInfo
  };
}, { walk });

console.log(JSON.stringify({
  bootMs,
  init: initLine,
  ...result,
  pageErrors,
  failedRequests: failed,
  tileLog: logs.filter((l) => l.startsWith('[madrid-tiles]')),
  consoleErrors: logs.filter((l) => /error|warn/i.test(l)).slice(0, 10)
}, null, 2));

await browser.close();
server.close();
