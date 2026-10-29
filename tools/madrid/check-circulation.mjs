// tools/madrid/check-circulation.mjs — verifies the B2 circulation network in a real browser:
// resident OSM graph swap, lane clearance inside the seed, car/pedestrian migration, continuity
// across the seed/tile seam, and route retirement when tiles are evicted.
//
// usage: node tools/madrid/check-circulation.mjs [--timeout 90] [--out docs/validation/...]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PW = process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.js';
const pwMod = await import(PW);
const chromium = pwMod.chromium || pwMod.default?.chromium;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const timeout = Number(arg('--timeout', '90000'));
const outDir = path.resolve(ROOT, arg('--out', 'docs/validation/2026-10-29-b2'));
fs.mkdirSync(outDir, { recursive: true });

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: process.env.HARDWARE_GPU
    ? ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=gl']
    : ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--enable-webgpu-developer-features']
});
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
const logs = [];
const errors = [];
page.on('console', (m) => { logs.push('[' + m.type() + '] ' + m.text()); });
page.on('pageerror', (e) => { errors.push(String(e)); });
const started = Date.now();
await page.goto('http://127.0.0.1:' + port + '/?debug=1&capture=1', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__madrid && window.__madrid.renderer && document.querySelector('#loading-overlay.hidden'),
  null, { timeout: timeout });
const bootMs = Date.now() - started;

const result = await page.evaluate(async ({ shotTargets, outNames }) => {
  const api = window.__madrid;
  const { tileStreamer, tileWorld, controllerManager, trafficSystem, roadService } = api;
  const waitFor = async (fn, ms = 60000) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
    return false;
  };
  const stats = () => {
    const network = trafficSystem.getNetwork();
    const cars = trafficSystem.cars;
    const peds = trafficSystem.peds;
    return {
      roadStats: api.roadStats,
      nodes: network.nodes.length, edges: network.edges.length,
      paintEdges: network.paintEdges?.length || 0, roadPaintStats: api.roadPaintStats,
      signals: network.nodes.filter((n) => n.signal).length,
      cars: cars.length, carsPlaced: cars.filter((v) => v.edge).length,
      peds: peds.length, pedsPlaced: peds.filter((p) => p.placed).length,
      tiles: tileWorld.ids(),
      frames: api.renderedFrames
    };
  };
  // Simulation consistency: every placed actor points into the live graph, keeps a finite position
  // along its own edge/track, and the lane offsets themselves stay inside the road the source tags
  // describe (no lane hanging past the carriageway by more than half its width).
  const simSanity = () => {
    const network = trafficSystem.getNetwork();
    const cars = trafficSystem.cars;
    const placed = cars.filter((v) => v.edge);
    const badS = placed.filter((v) => !Number.isFinite(v.s) || v.s < -2 || v.s > v.edge.len + 2).length;
    let overhang = 0, laneEdges = 0, maxOverhang = 0;
    for (const edge of network.edges) {
      if (!edge.lanes.length) continue;
      laneEdges++;
      for (const lane of edge.lanes) {
        const past = Math.abs(lane) + 0.9 - edge.half;
        if (past > 0.5) overhang++;
        if (past > maxOverhang) maxOverhang = past;
      }
    }
    return {
      carsPlaced: placed.length, badS,
      pedsOnTrack: trafficSystem.peds.filter((p) => p.placed && p.route).length,
      laneEdges, laneOverhang: overhang, maxLaneOverhang: +maxOverhang.toFixed(2)
    };
  };
  // Continuity from the seed to every mounted tile and every placed actor: finite hop distance and
  // no actor pointing at an edge that the current network no longer contains.
  const continuity = () => {
    const network = trafficSystem.getNetwork();
    const adjacency = new Map(network.nodes.map((n) => [n, []]));
    for (const e of network.edges) { adjacency.get(e.from).push(e.to); adjacency.get(e.to).push(e.from); }
    const nearest = (x, z) => network.nodes.reduce((best, n) => {
      const d = Math.hypot(n.x - x, n.z - z); return !best || d < best.d ? { n, d } : best;
    }, null);
    const start = nearest(0, 0);
    const hops = new Map([[start.n, 0]]);
    const queue = [start.n];
    for (let i = 0; i < queue.length; i++) for (const next of adjacency.get(queue[i])) {
      if (!hops.has(next)) { hops.set(next, hops.get(queue[i]) + 1); queue.push(next); }
    }
    const tileHops = {};
    for (const [id, tile] of tileWorld.residentGeometry()) {
      const core = tile.core && tile.core[0]; if (!core) continue;
      const target = nearest((core[0] + core[2]) / 2, (core[1] + core[3]) / 2);
      tileHops[id] = hops.has(target.n) ? hops.get(target.n) : null;
    }
    const edgeSet = new Set(network.edges);
    return {
      reachable: hops.size, nodes: network.nodes.length, tileHops,
      staleCars: trafficSystem.cars.filter((v) => v.edge && !edgeSet.has(v.edge)).length,
      stalePeds: trafficSystem.peds.filter((p) => p.route?.edge && !edgeSet.has(p.route.edge)).length
    };
  };
  const capture = async (name) => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const canvas = document.querySelector('canvas');
    const data = canvas.toDataURL('image/jpeg', 0.72);
    return { name, data };
  };
  const shots = [];
  const steps = [];
  const record = (label) => steps.push({ label, atMs: Math.round(performance.now()), ...stats(), simSanity: simSanity(), continuity: continuity() });

  await waitFor(() => api.roadStats && trafficSystem.getNetwork().nodes.length > 300, 120000);
  await new Promise((r) => setTimeout(r, 5000));
  record('seed after boot');

  // Street-level looks across the seed: the camera and the resident car network must agree with
  // the built pavement, and traffic must be visible from the pavement itself.
  const { TELEPORT_LOCATIONS } = await import(new URL('./js/city-config.js', location.href).href);
  document.querySelector('#mode-person').click();
  document.querySelector('#cam-chase').click();
  for (const id of ['sol', 'granvia', 'cibeles']) {
    const place = TELEPORT_LOCATIONS[id];
    controllerManager.teleportActiveTo(place.x, place.z, place.heading);
    await new Promise((r) => setTimeout(r, 5200));
    shots.push(await capture('street-' + id));
  }

  // Teleport across the seam: each mounted tile is reached, the network is rebuilt with it and
  // every actor still points at a live edge.
  const tileIds = tileWorld.ids();
  const targets = tileIds.slice(0, 3).map((id) => {
    const core = tileWorld.residentGeometry().get(id)?.core?.[0];
    return { id, x: (core[0] + core[2]) / 2, z: (core[1] + core[3]) / 2 };
  });
  for (const target of targets) {
    controllerManager.teleportActiveTo(target.x, target.z, 0);
    tileStreamer.update(target.x, target.z, performance.now());
    await waitFor(() => tileWorld.has(target.id), 60000);
    await new Promise((r) => setTimeout(r, 2500));
    record('at tile ' + target.id);
    if (targets.indexOf(target) < 2) shots.push(await capture('tile-' + target.id));
  }

  // Back to the centre, then leave the seed far enough that the streaming policy must unload the
  // tiles visited above. Their roads have to leave the network with them, without stranding actors.
  controllerManager.teleportActiveTo(0, 0, 0);
  tileStreamer.update(0, 0, performance.now());
  await new Promise((r) => setTimeout(r, 4000));
  record('back at seed');
  const beforeEviction = {
    tiles: tileWorld.ids(),
    edgeCount: trafficSystem.getNetwork().edges.length,
    cores: Object.fromEntries([...tileWorld.residentGeometry()].map(([id, tile]) => [id, tile.core?.[0]]))
  };
  controllerManager.teleportActiveTo(-3200, 0, 0);
  tileStreamer.update(-3200, 0, performance.now());
  await new Promise((r) => setTimeout(r, 3500));
  await waitFor(() => tileWorld.ids().length > 0, 30000);
  await new Promise((r) => setTimeout(r, 3500));
  const evicted = (() => {
    const network = trafficSystem.getNetwork();
    const before = new Set(beforeEviction.tiles);
    const dropped = [...before].filter((id) => !tileWorld.has(id));
    const cores = dropped.map((id) => ({ id, core: beforeEviction.cores[id] })).filter((t) => t.core);
    const inside = cores.map(({ id, core }) => ({ id, core,
      nodes: network.nodes.filter((n) => n.x >= core[0] && n.x <= core[2] && n.z >= core[1] && n.z <= core[3]).length
    }));
    return { before: [...before], dropped, edgesBefore: beforeEviction.edgeCount, edgesAfter: network.edges.length, nodesInsideDropped: inside, ...continuity() };
  })();

  const gl = document.querySelector('canvas').getContext('webgl2');
  const debugInfo = gl?.getExtension('WEBGL_debug_renderer_info');
  const glRenderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null;
  return { glRenderer, bootMs: null, steps, shots, evicted };
}, { shotTargets: [], outNames: [] });

result.bootMs = bootMs;
result.errors = errors;
result.warningLogs = logs.filter((l) => /^\[error\]|madrid-roads|resident network/.test(l)).slice(-12);
result.page = { width: 1280, height: 720 };
result.passed = errors.length === 0 && result.warningLogs.length === 0 &&
  result.steps.every((s) => s.carsPlaced > 0 && s.pedsPlaced > 0 && s.paintEdges > 0 &&
    s.simSanity.badS === 0 && s.simSanity.laneOverhang === 0 &&
    s.continuity.staleCars === 0 && s.continuity.stalePeds === 0 &&
    Object.values(s.continuity.tileHops).every(Number.isFinite)) &&
  result.evicted.dropped.length > 0 && result.evicted.nodesInsideDropped.every((tile) => tile.nodes === 0) &&
  result.evicted.staleCars === 0 && result.evicted.stalePeds === 0;
if (!result.passed) process.exitCode = 1;

for (const shot of result.shots) {
  const file = path.join(outDir, shot.name + '.jpg');
  fs.writeFileSync(file, Buffer.from(shot.data.split(',')[1], 'base64'));
  delete shot.data;
}
fs.writeFileSync(path.join(outDir, 'circulation.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ bootMs: result.bootMs, steps: result.steps.map((s) => ({ label: s.label, nodes: s.nodes, edges: s.edges, carsPlaced: s.carsPlaced, pedsPlaced: s.pedsPlaced, tiles: s.tiles.length, frames: s.frames, simSanity: s.simSanity, staleCars: s.continuity.staleCars, stalePeds: s.continuity.stalePeds, tileHops: s.continuity.tileHops })), evicted: result.evicted, errors: result.errors, warningLogs: result.warningLogs, shots: result.shots.map((s) => s.name) }, null, 2));
await browser.close();
server.close();