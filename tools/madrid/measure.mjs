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
const placesArg = args.indexOf('--places');
const places = placesArg >= 0 ? args[placesArg + 1].split(',') : [];
const view = args.includes('--aerial') ? 'maqueta' : 'chase';
const zoomArg = args.indexOf('--zoom');
const aerialZoom = zoomArg >= 0 ? Number(args[zoomArg + 1]) : 1;
if (!(aerialZoom >= 0.45 && aerialZoom <= 2.4)) throw new Error('--zoom must be 0.45..2.4');
const walk = bootOnly || places.length ? [] : tileArg >= 0 ? args[tileArg + 1].split(',') : ['k3j1', 'k4j1', 'k4j2', 'k2j-1', 'k0j-1', 'k0j3', 'k2j4'];

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

if (process.env.GL_PROFILE) await page.addInitScript(() => {
  globalThis.__glProfile = [];
  const methods = ['compileShader', 'linkProgram', 'getProgramParameter', 'getShaderParameter', 'bufferData', 'drawElementsInstanced', 'drawElements'];
  for (const name of methods) {
    const original = WebGL2RenderingContext.prototype[name];
    WebGL2RenderingContext.prototype[name] = function (...args) {
      const start = performance.now();
      try { return original.apply(this, args); }
      finally {
        const ms = performance.now() - start;
        if (ms > 2) {
          globalThis.__glProfile.push({ name, parameter: typeof args[1] === 'number' ? args[1] : null, at: performance.now(), ms });
          if (globalThis.__glProfile.length > 512) globalThis.__glProfile.shift();
        }
      }
    };
  }
});
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/?debug=1${process.env.WEBGL ? '&webgl=1' : ''}${process.env.WEBGPU ? '&webgpu=1' : ''}${process.env.GEOMETRY_DETAIL ? '&detail=geometry' : process.env.DISTANCE_DETAIL || process.env.DETAIL_COMPARE ? '&detail=distance' : ''}`, { waitUntil: 'load', timeout: 180000 });
// SwiftShader compiles the ~500 pipelines of the Madrid materials slowly: the loading screen can take several minutes
await page.waitForFunction(() => window.__madrid && window.__madrid.renderer && document.querySelector('#loading-overlay.hidden'), null, { timeout: 900000 });
const bootMs = Date.now() - t0;
const initLine = logs.find((l) => l.startsWith('[init]')) || '';

const hideRoots = (process.env.HIDE_ROOTS || '').split(',').filter(Boolean);
const clipRect = process.env.CLIP_RECT ? Object.fromEntries(process.env.CLIP_RECT.split(',').map((v, i) => [['x0','x1','z0','z1'][i], +v])) : null;
const result = await page.evaluate(async ({ walk, bootOnly, stress, places, view, aerialZoom, hideRoots, clipRect }) => {
  const { renderer, tileStreamer, tileWorld, controllerManager } = window.__madrid;
  const waitFor = async (fn, timeoutMs = 120000) => {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      if (fn()) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };
  window.__madrid.cameraSystem.zoomMultiplier = aerialZoom;
  if (view === 'maqueta') document.querySelector('#cam-maqueta').click();
  const routeStart = performance.now();
  const before = tileStreamer ? tileStreamer.status() : null;
  const tileMs = [];
  const placeSamples = [];
  if (places.length) {
    const { TELEPORT_LOCATIONS } = await import(new URL('./js/city-config.js', location.href).href);
    document.querySelector('#mode-person').click();
    for (const id of places) {
      const target = TELEPORT_LOCATIONS[id];
      if (!target) throw new Error(`Unknown place: ${id}`);
      controllerManager.teleportActiveTo(target.x, target.z, target.heading);
      document.querySelector(`#cam-${view}`).click();
      const start = performance.now();
      const firstFrame = window.__madrid.renderedFrames;
      await new Promise(resolve => setTimeout(resolve, 3000));
      const samples = (window.__madrid.frameSamples || []).filter(s => s.at >= start);
      const intervals = samples.map(s => s.intervalMs).sort((a,b) => a-b);
      placeSamples.push({ id, view, frames: window.__madrid.renderedFrames - firstFrame,
        elapsedMs: performance.now() - start,
        p95IntervalMs: intervals[Math.max(0, Math.ceil(intervals.length * 0.95) - 1)] || 0,
        maxIntervalMs: intervals.at(-1) || 0,
        position: { x: controllerManager.getActiveEntity().position.x, z: controllerManager.getActiveEntity().position.z } });
    }
  }
  if (tileStreamer) {
    for (const id of walk) {
      const tile = tileStreamer.tiles.find((t) => t.id === id);
      if (!tile) continue;
      const x = (tile.core[0][0] + tile.core[0][2]) / 2;
      const z = (tile.core[0][1] + tile.core[0][3]) / 2;
      controllerManager.teleportActiveTo(x, z, 0);
      if (view === 'maqueta') document.querySelector('#cam-maqueta').click();
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
  for (const n of hideRoots) { const o = window.__madrid.scene.getObjectByName(n); if (o) o.visible = false; }
  // Count completed application renders; renderer-info field names vary across Three.js versions.
  const frames0 = window.__madrid.renderedFrames || 0;
  const start = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const frames = (window.__madrid.renderedFrames || 0) - frames0;
  const secs = (performance.now() - start) / 1000;
  const info = renderer.info?.render || {};
  // Per-tile geometry: deck slab height, instanced buildings and the tiles' collider count.
  const sceneOf = window.__madrid.scene;
  const seedFacadeMaterials = new Set((sceneOf.getObjectByName('ManhattanCityBlocks')?.children || [])
    .filter((o) => o.geometry?.getAttribute('box')).map((o) => o.userData.madridDetailedMaterial || o.material));
  const tileStats = (tileWorld ? tileWorld.ids() : []).map((id) => {
    const g = sceneOf.getObjectByName(`MadridTile:${id}`);
    if (!g) return { id, missing: true };
    let meshes = 0, instances = 0, sharedFacades = 0, unsharedFacades = 0, deckMinY = Infinity, deckMaxY = -Infinity;
    const kinds = new Set(); const trisByName = {};
    g.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      if (/^TileBuildings/.test(o.name)) {
        if (seedFacadeMaterials.has(o.userData.madridDetailedMaterial || o.material)) sharedFacades++; else unsharedFacades++;
      }
      kinds.add(o.name);
      {
        const gm = o.geometry;
        const per = gm?.index ? gm.index.count / 3 : (gm?.attributes?.position?.count || 0) / 3;
        const n = per * (o.isInstancedMesh ? o.count : 1);
        const key = o.name.replace(/[:#]?\d+$/, '') || 'unnamed';
        const e = trisByName[key] ||= { meshes: 0, tris: 0, visibleTris: 0, geomBytes: 0 };
        e.meshes++; e.tris += n;
        let vis = o.visible; for (let a = o.parent; a && vis; a = a.parent) vis = a.visible;
        if (vis) e.visibleTris += n;
        for (const at of Object.values(gm?.attributes || {})) e.geomBytes += at.array.byteLength;
        if (gm?.index) e.geomBytes += gm.index.array.byteLength;
      }
      if (o.isInstancedMesh) instances += o.count;
      if (o.name === 'TileDeck') {
        o.geometry.computeBoundingBox();
        deckMinY = Math.min(deckMinY, o.geometry.boundingBox.min.y);
        deckMaxY = Math.max(deckMaxY, o.geometry.boundingBox.max.y);
      }
    });
    return { id, meshes, instances, sharedFacades, unsharedFacades, farGeometry: g.userData.farGeometry, farVisible: g.getObjectByName('TileFarBuildings')?.visible, deckMinY, deckMaxY, trisByName, colliders: g.userData.colliders?.length ?? 0, kinds: [...kinds] };
  });
  const sceneTris = {};
  sceneOf.children.forEach((c) => {
    let tris = 0, vis = 0, meshes = 0;
    c.traverse((o) => { if (!o.isMesh) return; const gm = o.geometry; const per = gm?.index ? gm.index.count / 3 : (gm?.attributes?.position?.count || 0) / 3; const n = per * (o.isInstancedMesh ? o.count : 1); tris += n; meshes++; let v = o.visible; for (let a = o.parent; a && v; a = a.parent) v = a.visible; if (v) vis += n; });
    if (tris) sceneTris[c.name || c.type] = { meshes, tris: Math.round(tris), visibleTris: Math.round(vis), visible: c.visible };
  });
  let clipStats = null;
  if (clipRect) {
    const { x0, x1, z0, z1 } = clipRect; clipStats = {};
    sceneOf.traverse((o) => {
      if (!o.isMesh || !/MadridTile:/.test(o.parent?.name || '') && !(o.parent && o.parent.parent && /MadridTile:/.test(o.parent.parent.name || ''))) return;
      const gm = o.geometry, pos = gm.attributes.position, ix = gm.index; if (!pos) return;
      o.updateWorldMatrix(true, false); const m = o.matrixWorld.elements;
      const tw = (i) => [m[0]*pos.getX(i)+m[4]*pos.getY(i)+m[8]*pos.getZ(i)+m[12], m[2]*pos.getX(i)+m[6]*pos.getY(i)+m[10]*pos.getZ(i)+m[14]];
      const nT = ix ? ix.count / 3 : pos.count / 3;
      const key = o.name.replace(/[:#]?\d+$/, '') || 'unnamed';
      const e = clipStats[key] ||= { tris: 0, instancedTrisInRect: 0, vertsInRect: 0 };
      if (o.isInstancedMesh) {
        // count instances whose geometry-bbox centre falls in the rect
        gm.computeBoundingBox(); const c = gm.boundingBox.getCenter(new gm.boundingBox.min.constructor()); const im = new o.instanceMatrix.array.constructor(16);
        for (let k = 0; k < o.count; k++) { o.getMatrixAt(k, o.matrix); const el = o.matrix.elements; const wx = el[0]*c.x+el[4]*c.y+el[8]*c.z+el[12], wz = el[2]*c.x+el[6]*c.y+el[10]*c.z+el[14]; if (wx>=x0&&wx<=x1&&wz>=z0&&wz<=z1) e.instancedTrisInRect += nT; }
        return;
      }
      for (let t = 0; t < nT; t++) {
        const a = ix ? ix.getX(t*3) : t*3, b = ix ? ix.getX(t*3+1) : t*3+1, c = ix ? ix.getX(t*3+2) : t*3+2;
        const A = tw(a), B = tw(b), C = tw(c); const cx = (A[0]+B[0]+C[0])/3, cz = (A[1]+B[1]+C[1])/3;
        if (cx>=x0&&cx<=x1&&cz>=z0&&cz<=z1) { e.tris++; }
      }
    });
  }
  const routeFrames = (window.__madrid.frameSamples || []).filter((s) => s.at >= routeStart);
  const intervals = routeFrames.map((s) => s.intervalMs).sort((a, b) => a - b);
  return {
    glProfile: (globalThis.__glProfile || []).filter(s => s.at >= routeStart),
    frameLatency: { samples: intervals.length, routeMs: performance.now() - routeStart,
      maxIntervalMs: intervals.at(-1) || 0,
      p95IntervalMs: intervals[Math.max(0, Math.ceil(intervals.length * 0.95) - 1)] || 0,
      maxRenderMs: Math.max(0, ...routeFrames.map((s) => s.renderMs)) },
    placeSamples,
    routeFrames: (window.__madrid.frameSamples || []).filter((s) => s.at >= routeStart),
    streaming: tileStreamer?.status(),
    distanceDetail: window.__madrid.distanceDetail?.status(),
    shaderWarmupHidden: sceneOf.getObjectByName('MadridTileShaderWarmup')?.visible === false,
    backend: renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
    tileStats, sceneTris, clipStats,
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
}, { walk, bootOnly, stress, places, view, aerialZoom, hideRoots, clipRect });

let detailComparison = null;
if (process.env.DETAIL_COMPARE) detailComparison = await page.evaluate(async () => {
  const api = window.__madrid;
  const results = [];
  for (const enabled of [false, true, false, true]) {
    api.distanceDetail.setEnabled(enabled);
    const first = api.renderedFrames;
    await new Promise(resolve => {
      const tick = () => api.renderedFrames > first + 5 ? resolve() : requestAnimationFrame(tick);
      requestAnimationFrame(tick);
    });
    const start = performance.now(), frames = api.renderedFrames;
    await new Promise(resolve => setTimeout(resolve, 2000));
    const samples = api.frameSamples.filter(s => s.at >= start);
    results.push({ enabled, elapsedMs: performance.now() - start, frames: api.renderedFrames - frames,
      meanRenderMs: samples.reduce((sum, s) => sum + s.renderMs, 0) / samples.length,
      detail: api.distanceDetail.status() });
  }
  return results;
});

let screenshotError = null;
if (process.env.SCREENSHOT) {
  process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
  try { await page.screenshot({ animations: 'disabled', path: process.env.SCREENSHOT, timeout: 30000 }); }
  catch (error) { screenshotError = error.message; }
}
if (process.env.VIEWS_DIR) {
  fs.mkdirSync(process.env.VIEWS_DIR, { recursive: true });
  process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
  await page.screenshot({ animations: 'disabled', path: path.join(process.env.VIEWS_DIR, 'street-desktop.png') });
  await page.locator('#cam-menu-btn').click();
  await page.locator('#cam-maqueta').click();
  await page.waitForFunction(() => window.__madrid.cameraSystem.currentPos.y > 500);
  await page.screenshot({ animations: 'disabled', path: path.join(process.env.VIEWS_DIR, 'model-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const touchSession = await page.context().newCDPSession(page);
  await touchSession.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 350 }] });
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => document.body.classList.contains('touch-enabled'));

  const frame = await page.evaluate(() => window.__madrid.renderedFrames);
  await page.waitForFunction((frame) => window.__madrid.renderedFrames > frame + 2, frame);
  await page.screenshot({ animations: 'disabled', path: path.join(process.env.VIEWS_DIR, 'model-mobile.png') });
  const overlap = await page.evaluate(() => {
    const a = document.querySelector('.hud-bottom-left').getBoundingClientRect();
    const b = document.querySelector('#mode-switch').getBoundingClientRect();
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  });
  if (overlap) throw new Error('Mobile location signs overlap the navigation modes');
}
const contextLost = logs.some((line) => /CONTEXT_LOST|Device Lost/i.test(line));
const graphicsErrors = logs.filter((line) => /GPUValidationError|Shader Error|GL_INVALID|Error compiling/i.test(line));
const passed = graphicsErrors.length === 0 && !contextLost && pageErrors.length === 0 && failed.length === 0 && result.frames > 0 && result.shaderWarmupHidden && result.placeSamples.every(p => p.frames > 0) && result.tileStats.every((tile) => !tile.unsharedFacades) && result.tileMs.every((tile) => tile.ok) && (result.after?.failures || 0) === 0 && !result.legacyBoroughs && result.fireEscapeInstances === 0;
console.log(JSON.stringify({
  passed,
  gpu: gpuInfo.gpu,
  contextLost,
  graphicsErrors,
  screenshotError,
  detailComparison,
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
