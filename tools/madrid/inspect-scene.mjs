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
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--enable-webgpu-developer-features']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('[pageerror]', String(e)));
await page.goto('http://127.0.0.1:' + port + '/?debug=1&capture=1', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__madrid && document.querySelector('#loading-overlay.hidden'), null, { timeout: 180000 });
const out = await page.evaluate(async ({ place, gridN, waitMs, ndcPoint, shotPath, at }) => {
  const THREE = await import('three');
  const api = window.__madrid;
  const { TELEPORT_LOCATIONS } = await import(new URL('./js/city-config.js', location.href).href);
  document.querySelector('#mode-person').click();
  document.querySelector('#cam-chase').click();
  const custom = at ? { x: Number(at.split(',')[0]), z: Number(at.split(',')[1]), heading: Number(at.split(',')[2] || 0) } : null;
  const target = custom || TELEPORT_LOCATIONS[place] || { x: 0, z: 0, heading: 0 };
  const startFrames = api.renderedFrames || 0;
  api.controllerManager.teleportActiveTo(target.x, target.z, target.heading);
  const t0 = performance.now();
  while (performance.now() - t0 < waitMs && (api.renderedFrames || 0) - startFrames < 3) {
    await new Promise((r) => setTimeout(r, 200));
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
  return { place, target, mode, entity: entityPos, camera: { x: +cameraPos.x.toFixed(1), y: +cameraPos.y.toFixed(1), z: +cameraPos.z.toFixed(1) }, occluders, shot,
    roadPaintStats: api.roadPaintStats || null, roadStats: api.roadStats ? { routingNodes: api.roadStats.routingNodes, routingEdges: api.roadStats.routingEdges } : null };
}, { place, gridN, waitMs, ndcPoint, shotPath, at });
if (jsonOut) fs.writeFileSync(path.resolve(ROOT, jsonOut), JSON.stringify({ ...out, shot: undefined }, null, 2));
if (shotPath && out.shot) fs.writeFileSync(path.resolve(ROOT, shotPath), Buffer.from(out.shot.split(',')[1], 'base64'));
console.log(JSON.stringify({ place: out.place, target: out.target, mode: out.mode, entity: out.entity, camera: out.camera, hits: out.occluders.length, jsonOut, shotPath, roadPaintStats: out.roadPaintStats }));
await browser.close();
server.close();