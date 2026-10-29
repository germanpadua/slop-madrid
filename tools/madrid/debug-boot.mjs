// tools/madrid/debug-boot.mjs — minimal boot diagnostics: console/pageerror capture, overlay wait
// with a hard timeout, circulation-network counters and a screenshot. Unlike measure.mjs it never
// waits minutes for a boot that already failed.
//
// usage: node tools/madrid/debug-boot.mjs [--timeout 90] [--shot /path.png] [--url-params ...]
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
const timeout = Number(arg('--timeout', '90')) * 1000;
const shot = arg('--shot', null);
const extra = arg('--params', '');
const after = Number(arg('--after', '3000'));
const failRoadWorker = args.includes('--fail-road-worker');

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
if (failRoadWorker) await page.route('**/js/madrid-road-worker.js', (route) => route.abort());
const logs = [];
const errors = [];
page.on('console', (m) => { logs.push(`[${m.type()}] ${m.text()}`); if (/error|warn/.test(m.type())) console.error('[console]', m.text()); });
page.on('pageerror', (e) => { errors.push(String(e)); console.error('[pageerror]', String(e)); });
page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));
const started = Date.now();
await page.goto(`http://127.0.0.1:${port}/?debug=1${extra}`, { waitUntil: 'load', timeout: 120000 });
let booted = false;
try {
  await page.waitForFunction(() => window.__madrid && window.__madrid.renderer && document.querySelector('#loading-overlay.hidden'),
    null, { timeout: Math.max(15000, timeout - (Date.now() - started)) });
  booted = true;
} catch {}
const elapsed = Date.now() - started;
if (booted && after > 0) await new Promise((resolve) => setTimeout(resolve, after));
const state = await page.evaluate(() => {
  const api = window.__madrid;
  const network = api?.trafficSystem?.getNetwork?.();
  const seed = api?.trafficSystem?.network;
  const status = document.querySelector('#loading-status')?.textContent || null;
  const overlayHidden = !!document.querySelector('#loading-overlay.hidden');
  const cars = api?.trafficSystem?.cars || [];
  const peds = api?.trafficSystem?.peds || [];
  return {
    hasApi: !!api, overlayHidden, status,
    loadingHidden: !!document.querySelector('#loading-overlay')?.classList.contains('hidden'),
    init: (window.__initTimings || []).slice?.(-12) || null,
    roadStats: api?.roadStats || null,
    network: network ? { nodes: network.nodes.length, edges: network.edges.length,
      paintEdges: network.paintEdges?.length || 0,
      signals: network.nodes.filter((n) => n.signal).length } : null,
    roadPaintStats: api?.roadPaintStats || null,
    seedNetwork: seed ? { nodes: seed.nodes.length, edges: seed.edges.length,
      sample: seed.edges.slice(0, 6).map((e) => ({ from: e.from.id, to: e.to.id, axis: e.axis, len: e.len, lanes: e.lanes })) } : null,
    seedInputs: api?.cityGrid ? {
      sidewalks: api.cityGrid.sidewalks.length,
      sidewalkSample: api.cityGrid.sidewalks.slice(0, 3),
      footprints: api.cityGrid.footprints.length,
      signals: api.streetDetails?.signalIntersections?.length ?? null
    } : null,
    cars: cars.length, carsPlaced: cars.filter((v) => v.edge).length,
    peds: peds.length, pedsPlaced: peds.filter((p) => p.placed).length,
    tiles: api?.tileWorld?.ids?.() || [],
    renderedFrames: api?.renderedFrames || null,
    // Continuity: graph hop distance from the network node nearest Sol (0, 0) to the network node
    // nearest each mounted tile centre. Finite means a car can drive from the seed into the tile.
    tileReach: (() => {
      if (!network) return null;
      const adjacency = new Map(network.nodes.map((n) => [n, []]));
      for (const e of network.edges) { adjacency.get(e.from)?.push(e.to); adjacency.get(e.to)?.push(e.from); }
      const nearest = (x, z) => network.nodes.reduce((best, n) => {
        const d = Math.hypot(n.x - x, n.z - z);
        return !best || d < best.d ? { n, d } : best;
      }, null);
      const start = nearest(0, 0);
      const hops = new Map([[start.n, 0]]);
      const queue = [start.n];
      for (let i = 0; i < queue.length; i++) {
        for (const next of adjacency.get(queue[i]) || []) {
          if (hops.has(next)) continue;
          hops.set(next, hops.get(queue[i]) + 1);
          queue.push(next);
        }
      }
      const geometry = api.tileWorld.residentGeometry();
      const out = {};
      for (const [id, tile] of geometry) {
        const core = tile.core && tile.core[0];
        if (!core) continue;
        const target = nearest((core[0] + core[2]) / 2, (core[1] + core[3]) / 2);
        out[id] = hops.has(target.n) ? hops.get(target.n) : null;
      }
      return { reached: hops.size, nodes: network.nodes.length, tiles: out };
    })(),
    // Every live actor must point at an edge/track of the current network, never at unloaded geometry.
    staleActors: (() => {
      if (!network) return null;
      const edgeSet = new Set(network.edges);
      return {
        cars: (api.trafficSystem?.cars || []).filter((v) => v.edge && !edgeSet.has(v.edge)).length,
        peds: (api.trafficSystem?.peds || []).filter((p) => p.route?.edge && !edgeSet.has(p.route.edge)).length
      };
    })()
  };
});
if (shot) { try { await page.screenshot({ path: shot, timeout: 30000 }); } catch (e) { console.error('[screenshot]', e.message); } }
const fallbackPassed = !failRoadWorker || (state.roadStats?.mode === 'main-fallback' && state.network?.edges > 300 && state.network?.paintEdges > 0);
if (!booted || !fallbackPassed) process.exitCode = 1;
console.log(JSON.stringify({ booted, failRoadWorker, fallbackPassed, elapsedMs: elapsed, errors, state, tailLogs: logs.slice(-40) }, null, 2));
await browser.close();
server.close();