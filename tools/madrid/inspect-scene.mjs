// tools/madrid/inspect-scene.mjs — visual QA helper: stand at a named Madrid place and raycast a
// screen grid, reporting what the camera is actually looking at (object names, materials, parents).
// The chase camera keeps smoothing after a teleport: on software GL the reported camera may still be
// travelling, so treat hits as "what is on screen now", not as a fixed-camera verdict.
// usage: node tools/madrid/inspect-scene.mjs --place cibeles [--grid 3] [--wait 6000] [--json-out file]
//        [--shot file.jpg] [--ndc "x,y;x,y"] [--at "x,z,heading"]  (--at for spots not in TELEPORT_LOCATIONS)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PW = process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.js';
const pwMod = await import(PW);
const chromium = pwMod.chromium || pwMod.default?.chromium;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const place = arg('--place', 'cibeles');
const gridN = Number(arg('--grid', '3'));
const waitMs = Number(arg('--wait', '6000'));
const jsonOut = arg('--json-out', null);
const shotPath = arg('--shot', null);
const ndcPoint = arg('--ndc', null);
const at = arg('--at', null);
const buildingsFile = arg('--buildings-file', null);
const view = arg('--view', 'chase');
const motionDir = arg('--motion-dir', null);
const zoom = Number(arg('--zoom', '1'));
if (!['chase', 'maqueta'].includes(view) || !(zoom >= 0.45 && zoom <= 2.4)) throw new Error('Invalid view/zoom');

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
let browser;
try {
browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: process.env.HARDWARE_GPU
    ? ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=gl']
    : ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--enable-webgpu-developer-features']
});
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
if (buildingsFile) await page.route('**/js/buildings.js', (route) => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(buildingsFile, 'utf8') }));
page.on('console', (m) => { if (m.type() === 'error' || process.env.VERBOSE) console.error('[console]', m.text()); });
page.on('pageerror', (e) => console.error('[pageerror]', String(e)));
await page.goto('http://127.0.0.1:' + port + '/?debug=1&capture=1', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => (window.__madrid && document.querySelector('#loading-overlay.hidden')) || document.querySelector('#loading-status button'), null, { timeout: 90000 });
if (await page.locator('#loading-status button').count()) throw new Error(await page.locator('#loading-status').textContent());
const out = await page.evaluate(async ({ place, gridN, waitMs, ndcPoint, shotPath, at, view, zoom }) => {
  const THREE = await import('three');
  const api = window.__madrid;
  const { footprintsOverlap, createMadridLandmarkReserves, overlapsMadridLandmark } = await import(new URL('./js/madrid-landmark-reserves.js', location.href).href);
  const { TELEPORT_LOCATIONS, LANDMARK_SITES } = await import(new URL('./js/city-config.js', location.href).href);
  document.querySelector('#mode-person').click();
  document.querySelector(`#cam-${view}`).click();
  api.cameraSystem.zoomMultiplier = zoom;
  const custom = at ? { x: Number(at.split(',')[0]), z: Number(at.split(',')[1]), heading: Number(at.split(',')[2] || 0) } : null;
  const target = custom || TELEPORT_LOCATIONS[place] || { x: 0, z: 0, heading: 0 };
  const startFrames = api.renderedFrames || 0;
  api.controllerManager.teleportActiveTo(target.x, target.z, target.heading);
  const t0 = performance.now();
  while (performance.now() - t0 < waitMs) {
    await new Promise((r) => setTimeout(r, 200));
  }
  const palace = LANDMARK_SITES['Palacio de Cibeles'];
  const ring = Array.from({ length: palace.ring.length / 2 }, (_, i) => [palace.ring[i * 2], palace.ring[i * 2 + 1]]);
  const overlappingPalace = [];
  const reserves = createMadridLandmarkReserves(LANDMARK_SITES);
  const overlappingLandmarks = Object.fromEntries(reserves.map((r) => [r.name, 0]));
  for (const block of api.cityBlocks?.allBlocks || []) for (const f of block.footprints) {
    const pts = f.pts ? f.pts.map((p) => [p.x, p.z]) : [[f.x0,f.z0],[f.x1,f.z0],[f.x1,f.z1],[f.x0,f.z1]];
    for (const reserve of reserves) if (overlapsMadridLandmark(pts, [reserve])) overlappingLandmarks[reserve.name]++;
    if (footprintsOverlap(pts, ring)) overlappingPalace.push({ block: block.id, pts, height: f.h });
  }
  const entity = api.controllerManager.getActiveEntity?.();
  const entityPos = entity ? { x: +entity.position.x.toFixed(1), y: +entity.position.y.toFixed(1), z: +entity.position.z.toFixed(1) } : null;
  const mode = api.controllerManager.activeMode;
  const camera = api.cameraSystem.camera;
  camera.updateMatrixWorld();
  const describe = (hit) => {
    const chain = [];
    for (let o = hit.object; o; o = o.parent) chain.push(o.name || o.type);
    const m = hit.object.material;
    const mat = Array.isArray(m) ? m.map((x) => ({ name: x?.name, type: x?.type, color: x?.color?.getHexString?.() }))
      : m ? { name: m.name, type: m.type, color: m.color?.getHexString?.() } : null;
    return {
      name: hit.object.name, parentChain: chain.slice(0, 5), distance: +hit.distance.toFixed(1),
      point: { x: +hit.point.x.toFixed(1), y: +hit.point.y.toFixed(1), z: +hit.point.z.toFixed(1) },
      material: mat, geometry: hit.object.geometry?.type
    };
  };
  const raycaster = new THREE.Raycaster();
  const occluders = [];
  const points = [];
  if (ndcPoint) for (const pair of ndcPoint.split(';')) {
    const [x, y] = pair.split(',').map(Number);
    points.push(new THREE.Vector2(x, y));
  }
  else for (let ix = 0; ix < gridN; ix++) {
    for (let iy = 0; iy < gridN; iy++) points.push(new THREE.Vector2(((ix + 0.5) / gridN) * 2 - 1, 1 - ((iy + 0.5) / gridN) * 2));
  }
  for (const ndc of points) {
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(api.scene.children, true);
    if (hits.length) occluders.push({ ndc: { x: +ndc.x.toFixed(2), y: +ndc.y.toFixed(2) }, ...describe(hits[0]) });
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const shot = shotPath ? document.querySelector('canvas').toDataURL('image/jpeg', 0.72) : null;
  const cameraPos = camera.getWorldPosition(new THREE.Vector3());
  const gl = document.querySelector('canvas').getContext('webgl2');
  const debugInfo = gl?.getExtension('WEBGL_debug_renderer_info');
  const glRenderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null;
  return { overlappingLandmarks, view, zoom, overlappingPalace, glRenderer, framesAfterTeleport: (api.renderedFrames || 0) - startFrames, place, target, mode, entity: entityPos, camera: { x: +cameraPos.x.toFixed(1), y: +cameraPos.y.toFixed(1), z: +cameraPos.z.toFixed(1) }, occluders, shot,
    roadPaintStats: api.roadPaintStats || null, roadStats: api.roadStats ? { routingNodes: api.roadStats.routingNodes, routingEdges: api.roadStats.routingEdges } : null };
}, { place, gridN, waitMs, ndcPoint, shotPath, at, view, zoom });
if (motionDir) {
  fs.mkdirSync(motionDir, { recursive: true });
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => { window.__madrid.cameraSystem.orbitYawOffset += 0.35; });
    await page.waitForTimeout(2000);
    const data = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/jpeg', 0.8));
    fs.writeFileSync(path.join(motionDir, `orbit-${i}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
  }
}
if (jsonOut) fs.writeFileSync(path.resolve(ROOT, jsonOut), JSON.stringify({ ...out, shot: undefined }, null, 2));
if (shotPath && out.shot) fs.writeFileSync(path.resolve(ROOT, shotPath), Buffer.from(out.shot.split(',')[1], 'base64'));
console.log(JSON.stringify({ place: out.place, target: out.target, mode: out.mode, entity: out.entity, camera: out.camera, hits: out.occluders.length, jsonOut, shotPath, roadPaintStats: out.roadPaintStats }));
} finally {
  await browser?.close();
  server.close();
}