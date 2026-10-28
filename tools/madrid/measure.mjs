// tools/madrid/measure.mjs — phase-3 load-time / streaming / frame-cost measurement in headless Chromium.
//
// Serves the repo (the same static tree GitHub Pages deploys), boots the app with ?debug (it exposes
// window.__madrid), reads the [init] phase timings, then walks the camera across the phase-3 tiles and reports the
// per-tile import+build time, the resident geodata, and the renderer's frame cost.
//
// By default headless uses SwiftShader; HARDWARE_GPU=1 requests the local GPU.
// Always inspect the reported renderer: software FPS is not a hardware measurement.
//
// usage: node tools/madrid/measure.mjs [--tiles k3j1,k4j1,...]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PW = process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.js';
const pwMod = await import(PW);
const chromium = pwMod.chromium || pwMod.default?.chromium;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
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
const bootOnly = args.includes('--boot-only');
const stress = args.includes('--stress');
const walk = bootOnly ? [] : tileArg >= 0 ? args[tileArg + 1].split(',') : ['k3j1', 'k4j1', 'k4j2', 'k2j-1', 'k0j-1', 'k0j3', 'k2j4'];

let browser;
try {
browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined, // e.g. /usr/bin/google-chrome when no bundled chromium
  args: process.env.HARDWARE_GPU
    ? ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=gl']
    : ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--enable-webgpu-developer-features']
});
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
const gpuInfo = await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
const logs = [];
const pageErrors = [];
const failed = [];
page.on('console', (m) => { logs.push(m.text()); if (process.env.VERBOSE) console.error(m.text()); });
page.on('pageerror', (e) => { pageErrors.push(String(e)); console.error('[pageerror]', String(e)); });
page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));

const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/?debug=1${process.env.WEBGL ? '&webgl=1' : ''}${process.env.WEBGPU ? '&webgpu=1' : ''}`, { waitUntil: 'load', timeout: 180000 });
// SwiftShader compiles the ~500 pipelines of the Madrid materials slowly: the loading screen can take several minutes
await page.waitForFunction(() => window.__madrid && window.__madrid.renderer && document.querySelector('#loading-overlay.hidden'), null, { timeout: 900000 });
const bootMs = Date.now() - t0;
const initLine = logs.find((l) => l.startsWith('[init]')) || '';

const result = await page.evaluate(async ({ walk, bootOnly, stress }) => {
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
  if (tileStreamer) {
    for (const id of walk) {
      const tile = tileStreamer.tiles.find((t) => t.id === id);
      if (!tile) continue;
      const x = (tile.core[0][0] + tile.core[0][2]) / 2;
      const z = (tile.core[0][1] + tile.core[0][3]) / 2;
      controllerManager.teleportActiveTo(x, z, 0);
      const t = performance.now();
      tileStreamer.update(x, z, performance.now());
      const ok = await waitFor(() => tileStreamer.loaded.has(id), 90000);
      tileMs.push({ id, ok, ms: Math.round(performance.now() - t) });
    }
  }
  // Force a 4-6 tile resident set around the Retiro cluster (the streaming policy still enforces the byte budget).
  if (tileStreamer && !bootOnly && stress) {
    tileStreamer.budget.preloadRadius = 5000;
    controllerManager.teleportActiveTo(1800, 0, 0);
    tileStreamer.update(1800, 0, performance.now());
    await waitFor(() => tileStreamer.status().loaded.length >= 6, 120000);
  }
  const tileSet = tileStreamer ? tileStreamer.status() : null;
  // Count completed application renders; renderer-info field names vary across Three.js versions.
  const frames0 = window.__madrid.renderedFrames || 0;
  const start = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const frames = (window.__madrid.renderedFrames || 0) - frames0;
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
    backend: renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
    tileStats,
    tiles: before,
    after: tileSet,
    tileMs,
    fps: frames / secs,
    frames,
    legacyBoroughs: Boolean(sceneOf.getObjectByName('Boroughs')),
    fireEscapeInstances: (() => {
      let count = 0;
      sceneOf.traverse((o) => { if (/^FireEscapes/.test(o.name)) count += o.isInstancedMesh ? o.count : 1; });
      return count;
    })(),
    drawCalls: info.drawCalls ?? info.calls ?? null,
    triangles: info.triangles ?? null,
    residentBytes: tileWorld ? tileWorld.residentBytes() : 0,
    meshes: tileWorld ? tileWorld.meshCount() : 0,
    loaded: tileWorld ? tileWorld.ids() : []
  };
}, { walk, bootOnly, stress });

let screenshotError = null;
if (process.env.SCREENSHOT) {
  process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
  try { await page.screenshot({ path: process.env.SCREENSHOT, timeout: 30000 }); }
  catch (error) { screenshotError = error.message; }
}
if (process.env.VIEWS_DIR) {
  fs.mkdirSync(process.env.VIEWS_DIR, { recursive: true });
  process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
  await page.screenshot({ path: path.join(process.env.VIEWS_DIR, 'street-desktop.png') });
  await page.locator('#cam-menu-btn').click();
  await page.locator('#cam-maqueta').click();
  await page.waitForFunction(() => window.__madrid.cameraSystem.currentPos.y > 500);
  await page.screenshot({ path: path.join(process.env.VIEWS_DIR, 'model-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const touchSession = await page.context().newCDPSession(page);
  await touchSession.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 350 }] });
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => document.body.classList.contains('touch-enabled'));

  const frame = await page.evaluate(() => window.__madrid.renderedFrames);
  await page.waitForFunction((frame) => window.__madrid.renderedFrames > frame + 2, frame);
  await page.screenshot({ path: path.join(process.env.VIEWS_DIR, 'model-mobile.png') });
  const overlap = await page.evaluate(() => {
    const a = document.querySelector('.hud-bottom-left').getBoundingClientRect();
    const b = document.querySelector('#mode-switch').getBoundingClientRect();
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  });
  if (overlap) throw new Error('Mobile location signs overlap the navigation modes');
}
const contextLost = logs.some((line) => /CONTEXT_LOST|Device Lost/i.test(line));
const graphicsErrors = logs.filter((line) => /GPUValidationError|Shader Error|GL_INVALID|Error compiling/i.test(line));
const passed = graphicsErrors.length === 0 && !contextLost && pageErrors.length === 0 && failed.length === 0 && result.frames > 0 && result.tileMs.every((tile) => tile.ok) && (result.after?.failures || 0) === 0 && !result.legacyBoroughs && result.fireEscapeInstances === 0;
console.log(JSON.stringify({
  passed,
  gpu: gpuInfo.gpu,
  contextLost,
  graphicsErrors,
  screenshotError,
  bootMs,
  stress,
  init: initLine,
  ...result,
  pageErrors,
  failedRequests: failed,
  tileLog: logs.filter((l) => l.startsWith('[madrid-tiles]')),
  consoleErrors: logs.filter((l) => /error|warn/i.test(l)).slice(0, 10)
}, null, 2));

if (!passed || screenshotError) process.exitCode = 1;
} finally {
  await browser?.close();
  server.close();
}
