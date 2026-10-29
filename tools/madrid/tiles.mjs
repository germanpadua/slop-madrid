// tools/madrid/tiles.mjs — phase-3 tiled geodata for the interior of the M-30.
//
// Generates tools/madrid/tiles.json: the tile manifest for the almendra central (the area enclosed by the M-30),
// plus the driver that fetches and builds individual tiles with the same pipeline as the phase-2 geodata
// (tools/madrid/fetch.sh + tools/madrid/build.mjs, both parametrised by the tile bbox through config.mjs).
//
// Grid (parametric, UTM 30N / EPSG:25830): 1 000 m cells with a 100 m fetch overlap (every tile downloads the
// ring around its core so no building is ever cut at a tile seam). The grid origin is the phase-2 box corner
// (438450, 4472800), which is also the seed tile's south-west corner:
//   x lines 438450 + 1000 k , y lines 4472800 + 1000 j    (cell (k, j) = [x(k), x(k)+1000] x [y(j), y(j)+1000])
// The seed tile `fase2` is the phase-2 box itself (3 250 x 2 600 m); any cell that overlaps it has that part
// removed from its core (a cell core is therefore a list of rectangles, 1 or 2 per cell).
//
// The almendra outline is derived from real geometry: the OSM M-30 ways (ref=M-30, tools/data/madrid/m30.json)
// are rasterised as a barrier and the region containing Puerta del Sol is flood-filled. North of the ring the
// M-30 stops being a ring and continues as the A-6 / A-1 radials (av. de la Ilustración), so the fill leaks out
// through those interchanges; the mask is capped at ALMENDRA_CAP_Z, the ring's northern apex, and the cap is
// recorded in the manifest. Nothing else is invented: no smoothing, no hand-drawn boundary.
//
// usage:
//   node tools/madrid/tiles.mjs manifest                 regenerate tiles.json (keeps ready tiles' hashes)
//   node tools/madrid/tiles.mjs build k3j1 k4j1 ...      fetch + build those tiles, update tiles.json
//   node tools/madrid/tiles.mjs build --no-fetch k3j1    rebuild from the tile's existing raw data
//   node tools/madrid/tiles.mjs verify                   check every ready tile's module md5/size vs the manifest
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rdp, ringArea } from '../geo-geometry.mjs';
const log = (...args) => console.log('[madrid]', ...args);
import { utmForward, utmInverse, utmToWorld, SOLX, SOLY } from './projection.mjs';
import { PHASES } from './config.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '../..');
const DATA = path.join(ROOT, 'tools/data/madrid');
const MANIFEST = path.join(DIR, 'tiles.json');
const MODULE_DIR = path.join(ROOT, 'js/geodata');

const CELL = 1000;      // core size (m)
const OVERLAP = 100;    // fetch padding around the core (m) — deeper than any cadastral block, so seams stay whole
const SEED = 'fase2';
const SEED_UTM = PHASES.fase2.utm;

// Tiles generated in this phase. The six areas named for phase 3 map onto seven 1 km cells (the Retiro spans two).
const PHASE3 = ['k3j1', 'k4j1', 'k4j2', 'k2j-1', 'k0j-1', 'k0j3', 'k2j4'];
const LABELS = {
  k3j1: 'Retiro oeste (Atocha, Jerónimos)',
  k4j1: 'Retiro este (Retiro, Salamanca sur)',
  k4j2: 'Salamanca este (Guindalera, Fuente del Berro)',
  'k2j-1': 'Arganzuela (Delicias, Legazpi)',
  'k0j-1': 'Latina (Casa de Campo este, Manzanares sur)',
  k0j3: 'Moncloa (Argüelles, Moncloa)',
  k2j4: 'Chamartín sur (Nuevos Ministerios)',
};
const SOURCES = [
  'OpenStreetMap Overpass (© OpenStreetMap contributors, ODbL)',
  'IDEAM EDIFICIOS_ALTURAS (© Ayuntamiento de Madrid)',
  'Catastro INSPIRE WFS (© IGN/Catastro)',
];

// The M-30 ring is open to the north (the road continues as the A-6 / A-1 radials): the flood fill is capped at
// the ring's northern apex, which is where those two branches leave the almendra. Value in world z (m).
const ALMENDRA_CAP_Z = -6300;
const MASK_STEP = 40;   // flood-fill raster (m)
const BARRIER_R = 30;   // half-width of the motorway barrier (m): keeps the fill on the carriageway side

// ---------------------------------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------------------------------
const rectUnionArea = (rects) => rects.reduce((t, [x0, z0, x1, z1]) => t + (x1 - x0) * (z1 - z0), 0);
const inRect = ([x, z], [x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
const intersects = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const round1 = (v) => Math.round(v * 10) / 10;

function cellUtm(i, j) {
  return [SEED_UTM[0] + CELL * i, SEED_UTM[1] + CELL * j, SEED_UTM[0] + CELL * (i + 1), SEED_UTM[1] + CELL * (j + 1)];
}
function tileId(i, j) { return `k${i}j${j}`; }
function utmRectToWorld([x0, y0, x1, y1]) {
  const [wx0, wz1] = utmToWorld(x0, y0);
  const [wx1, wz0] = utmToWorld(x1, y1);
  return [wx0, wz0, wx1, wz1];
}

// Cell core in world metres: the cell rect minus the seed box (and minus any tile claimed before it).
function cellCore(i, j) {
  const [x0, z0, x1, z1] = utmRectToWorld(cellUtm(i, j)); // world metres, z grows south
  const seed = utmRectToWorld(SEED_UTM);
  const rects = [];
  const xs = [x0];
  if (seed[0] > x0 && seed[0] < x1) xs.push(seed[0]);
  if (seed[2] > x0 && seed[2] < x1) xs.push(seed[2]);
  xs.push(x1);
  const zs = [z0];
  if (seed[1] > z0 && seed[1] < z1) zs.push(seed[1]);
  if (seed[3] > z0 && seed[3] < z1) zs.push(seed[3]);
  zs.push(z1);
  for (let s = 0; s + 1 < xs.length; s++) {
    for (let t = 0; t + 1 < zs.length; t++) {
      const raw = [xs[s], zs[t], xs[s + 1], zs[t + 1]];
      if (raw[2] - raw[0] < 0.01 || raw[3] - raw[1] < 0.01) continue;
      const insideSeed = raw[0] >= seed[0] - 0.01 && raw[2] <= seed[2] + 0.01 && raw[1] >= seed[1] - 0.01 && raw[3] <= seed[3] + 0.01;
      if (!insideSeed) rects.push(raw.map(round1));
    }
  }
  return mergeRects(rects);
}

// Merge rectangles that share a full edge (the L-shaped corner cores become two rects, not four).
function mergeRects(rects) {
  const out = rects.map((r) => r.slice());
  for (let changed = true; changed;) {
    changed = false;
    for (let a = 0; a < out.length && !changed; a++) {
      for (let b = a + 1; b < out.length; b++) {
        const A = out[a], B = out[b];
        const sameX = A[0] === B[0] && A[2] === B[2];
        const sameZ = A[1] === B[1] && A[3] === B[3];
        if (sameX && (A[3] === B[1] || B[3] === A[1])) {
          out[a] = [A[0], Math.min(A[1], B[1]), A[2], Math.max(A[3], B[3])];
        } else if (sameZ && (A[2] === B[0] || B[2] === A[0])) {
          out[a] = [Math.min(A[0], B[0]), A[1], Math.max(A[2], B[2]), A[3]];
        } else continue;
        out.splice(b, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Almendra: rasterise the M-30, flood-fill from Puerta del Sol, trace + simplify the boundary
// ---------------------------------------------------------------------------------------------------------------------
function almendraRing() {
  const file = path.join(DATA, 'm30.json');
  if (!fs.existsSync(file)) {
    log('m30.json missing: the almendra outline needs `node tools/madrid/tiles.mjs fetch-m30`');
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const segs = [];
  for (const e of raw.elements || []) {
    if (e.type !== 'way' || !e.geometry || e.tags?.ref !== 'M-30') continue;
    const pts = e.geometry.filter((p) => p).map((p) => {
      const [east, north] = utmForward(p.lon, p.lat);
      return [east - SOLX, SOLY - north];
    }).filter(([x, z]) => Math.abs(x) < 9000 && Math.abs(z) < 9000);
    for (let i = 1; i < pts.length; i++) {
      if (Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) >= 1) segs.push([pts[i - 1], pts[i]]);
    }
  }
  if (!segs.length) throw new Error('no M-30 ways in m30.json');

  // Bounds: the M-30's extent around the centre (the ring plus the radial stubs that get capped below).
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [a, b] of segs) {
    for (const [x, z] of [a, b]) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
  }
  const pad = 400;
  x0 = Math.floor((x0 - pad) / MASK_STEP) * MASK_STEP;
  z0 = Math.floor((z0 - pad) / MASK_STEP) * MASK_STEP;
  const W = Math.ceil((x1 + pad - x0) / MASK_STEP) + 1;
  const H = Math.ceil((z1 + pad - z0) / MASK_STEP) + 1;
  const barrier = new Uint8Array(W * H);
  for (const [a, b] of segs) {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz;
    if (!len2) continue;
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - BARRIER_R - x0) / MASK_STEP));
    const i1 = Math.min(W - 1, Math.ceil((Math.max(a[0], b[0]) + BARRIER_R - x0) / MASK_STEP));
    const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - BARRIER_R - z0) / MASK_STEP));
    const j1 = Math.min(H - 1, Math.ceil((Math.max(a[1], b[1]) + BARRIER_R - z0) / MASK_STEP));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = x0 + (i + 0.5) * MASK_STEP, z = z0 + (j + 0.5) * MASK_STEP;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / len2));
        const px = a[0] + t * dx - x, pz = a[1] + t * dz - z;
        if (px * px + pz * pz <= BARRIER_R * BARRIER_R) barrier[j * W + i] = 1;
      }
    }
  }

  // 4-connected flood fill from Sol, capped at the ring's northern apex and at the raster bounds.
  const inside = new Uint8Array(W * H);
  const si = Math.floor((0 - x0) / MASK_STEP), sj = Math.floor((0 - z0) / MASK_STEP);
  const stack = [sj * W + si];
  inside[sj * W + si] = 1;
  while (stack.length) {
    const k = stack.pop();
    const i = k % W, j = (k - i) / W;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
      const kk = jj * W + ii;
      if (inside[kk] || barrier[kk]) continue;
      if (z0 + (jj + 0.5) * MASK_STEP < ALMENDRA_CAP_Z) continue;
      inside[kk] = 1;
      stack.push(kk);
    }
  }

  // Boundary trace: every filled cell contributes the edges shared with an empty cell, chained into rings.
  const next = new Map(); // "x,z" -> "x,z", unit steps on the cell lattice
  const key = (x, z) => `${x},${z}`;
  const addEdge = (ax, az, bx, bz) => {
    if (!next.has(key(ax, az))) next.set(key(ax, az), []);
    next.get(key(ax, az)).push([bx, bz]);
  };
  const filled = (i, j) => i >= 0 && j >= 0 && i < W && j < H && inside[j * W + i];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (!filled(i, j)) continue;
      const X = x0 + i * MASK_STEP, Z = z0 + j * MASK_STEP;
      if (!filled(i, j - 1)) addEdge(X, Z, X + MASK_STEP, Z);
      if (!filled(i, j + 1)) addEdge(X + MASK_STEP, Z + MASK_STEP, X, Z + MASK_STEP);
      if (!filled(i - 1, j)) addEdge(X, Z + MASK_STEP, X, Z);
      if (!filled(i + 1, j)) addEdge(X + MASK_STEP, Z, X + MASK_STEP, Z + MASK_STEP);
    }
  }
  let ring = [];
  while (next.size) {
    const [start] = next.keys();
    const [sx, sz] = start.split(',').map(Number);
    const pts = [[sx, sz]];
    let cur = [sx, sz];
    while (true) {
      const outs = next.get(key(cur[0], cur[1]));
      if (!outs || !outs.length) { next.delete(key(cur[0], cur[1])); break; }
      const nx = outs.pop();
      if (!outs.length) next.delete(key(cur[0], cur[1]));
      cur = nx;
      if (cur[0] === sx && cur[1] === sz) break;
      pts.push(cur);
    }
    if (Math.abs(ringArea(pts)) > Math.abs(ringArea(ring))) ring = pts;
  }
  if (ring.length < 4) throw new Error('almendra boundary trace failed');

  ring = rdp(ring, 20);
  const area = Math.abs(ringArea(ring)) / 1e6;
  const cells = [...inside].reduce((t, v) => t + v, 0);
  log(`almendra: ${area.toFixed(2)} km² (mask ${(cells * MASK_STEP * MASK_STEP / 1e6).toFixed(2)} km²), ${ring.length} vertices`);
  return { ring: ring.map(([x, z]) => [round1(x), round1(z)]), areaKm2: Math.round(area * 100) / 100, capZ: ALMENDRA_CAP_Z, maskAreaKm2: Math.round(cells * MASK_STEP * MASK_STEP / 100) / 100 };
}

// ---------------------------------------------------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------------------------------------------------
function wgs84Of(utmBox) {
  const [lon0, lat0] = utmInverse(utmBox[0], utmBox[1]);
  const [lon1, lat1] = utmInverse(utmBox[2], utmBox[3]);
  return [lon0, lat0, lon1, lat1].map((v) => Math.round(v * 1e6) / 1e6);
}

function tileEntry(i, j, almendra, prev) {
  const cell = cellUtm(i, j);
  const core = cellCore(i, j);
  if (!core.length) return null;
  // A cell only belongs to the almendra if its core meets the M-30 interior.
  const ringPoly = almendra ? almendra.ring : null;
  let touches = !ringPoly;
  if (ringPoly) {
    const bb = [Math.min(...ringPoly.map((p) => p[0])), Math.min(...ringPoly.map((p) => p[1])), Math.max(...ringPoly.map((p) => p[0])), Math.max(...ringPoly.map((p) => p[1]))];
    for (const r of core) if (intersects(r, bb)) touches = true;
  }
  if (!touches) return null;
  const fetchBox = [cell[0] - OVERLAP, cell[1] - OVERLAP, cell[2] + OVERLAP, cell[3] + OVERLAP];
  const id = tileId(i, j);
  const areaKm2 = Math.round(rectUnionArea(core) / 1e4) / 100;
  return {
    id,
    i,
    j,
    label: LABELS[id] || `Tesela ${id}`,
    status: prev?.status === 'ready' ? 'ready' : prev?.status === 'failed' ? 'failed' : 'pending',
    core,
    cell,
    fetch: fetchBox,
    bboxWgs84: wgs84Of(fetchBox),
    module: `js/geodata/tile-${id}.js`,
    overlapped: cell.reduce((t, v) => t + v, 0) > rectUnionArea(core) ? true : false,
    areaKm2,
    bytes: prev?.bytes ?? null,
    md5: prev?.md5 ?? null,
    counts: prev?.counts ?? null,
    error: prev?.status === 'failed' ? prev.error ?? null : null,
    sources: prev?.sources || SOURCES,
    ...(prev?.sourceSnapshot ? { sourceSnapshot: prev.sourceSnapshot } : {}),
  };
}

function seedEntry(prev) {
  const core = utmRectToWorld(SEED_UTM);
  const fetchBox = [SEED_UTM[0] - OVERLAP, SEED_UTM[1] - OVERLAP, SEED_UTM[2] + OVERLAP, SEED_UTM[3] + OVERLAP];
  return {
    id: SEED,
    label: 'Almendra central oeste — fase 2 (Manzanares-Atocha)',
    status: 'ready',
    core: [core.map(round1)],
    cell: SEED_UTM,
    fetch: fetchBox,
    bboxWgs84: wgs84Of(fetchBox),
    module: 'js/madrid-geodata.js',
    blocksModule: 'js/madrid-geodata-blocks.js',
    overlapped: false,
    areaKm2: Math.round(((SEED_UTM[2] - SEED_UTM[0]) * (SEED_UTM[3] - SEED_UTM[1])) / 1e4) / 100,
    bytes: prev?.bytes ?? null,
    md5: prev?.md5 ?? null,
    blocksBytes: prev?.blocksBytes ?? null,
    blocksMd5: prev?.blocksMd5 ?? null,
    counts: prev?.counts ?? null,
    sources: SOURCES,
  };
}

// Status is reconciled from the modules on disk: a tile is ready when its module exists and its hash/size are recorded
// from the file. Parallel builds may race on tiles.json; regenerating the manifest heals it from the modules.
function reconcile(entry, modules) {
  const st = modules.map((m) => fileStats(m ? path.join(ROOT, m) : null));
  if (!st[0]) return entry;
  Object.assign(entry, { status: 'ready', bytes: st[0].bytes, md5: st[0].md5 });
  if (modules[1] && st[1]) Object.assign(entry, { blocksBytes: st[1].bytes, blocksMd5: st[1].md5 });
  if (!modules[1]) { try { entry.counts = tileCounts(path.join(ROOT, modules[0])); } catch { /* keep null */ } }
  entry.error = null;
  return entry;
}

function manifest(prevManifest) {
  const prev = new Map((prevManifest?.tiles || []).map((t) => [t.id, t]));
  const almendra = almendraRing();
  const seed = seedEntry(prev.get(SEED));
  reconcile(seed, [seed.module, seed.blocksModule]);
  if (!seed.counts) {
    try { seed.counts = seedCounts(path.join(ROOT, seed.blocksModule)); } catch { /* keep null */ }
  }
  const tiles = [seed];
  // Every cell of the UTM grid that meets the almendra (the whole interior, phase 4 will fill them in).
  for (let i = -8; i <= 8; i++) {
    for (let j = -8; j <= 8; j++) {
      if (i === 0 && j === 0) continue;
      const t = tileEntry(i, j, almendra, prev.get(tileId(i, j)));
      if (t) tiles.push(t);
    }
  }
  for (const id of PHASE3) {
    if (!tiles.some((t) => t.id === id)) {
      const m = /^k(-?\d+)j(-?\d+)$/.exec(id);
      const t = m ? tileEntry(Number(m[1]), Number(m[2]), almendra, prev.get(id)) : null;
      if (t) tiles.push(t);
    }
  }
  for (const t of tiles) {
    if (t.id === SEED) continue;
    if (t.module && fs.existsSync(path.join(ROOT, t.module))) reconcile(t, [t.module, null]);
  }
  const ready = tiles.filter((t) => t.status === 'ready');
  const bytes = ready.reduce((n, t) => n + (t.bytes || 0) + (t.blocksBytes || 0), 0);
  return {
    version: 1,
    generated: new Date().toISOString().slice(0, 10),
    crs: 'EPSG:25830',
    frame: { origin: 'Puerta del Sol', units: 'm', x: 'east', z: 'south' },
    grid: { origin: SEED_UTM, cell: CELL, overlap: OVERLAP, seed: SEED, coordinate: 'cell (k, j) starts at origin + 1000*(k, j)' },
    almendra,
    phases: { '2': [SEED], '3': PHASE3, '4': 'every tile of this manifest (plan, see MADRID.md)' },
    budget: {
      maxResidentBytes: 12 * 1024 * 1024,
      maxResidentTiles: 12,
      preloadRadius: 1600,
      dropRadius: 2600,
    },
    totals: { tiles: tiles.length, ready: ready.length, pending: tiles.filter((t) => t.status === 'pending').length, failed: tiles.filter((t) => t.status === 'failed').length, readyBytes: bytes, readyKm2: Math.round(ready.reduce((n, t) => n + (t.areaKm2 || 0), 0) * 100) / 100 },
    tiles,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Driver: fetch + build a tile, then record its hash and size.
// ---------------------------------------------------------------------------------------------------------------------
function run(cmd, args, env) {
  execFileSync(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'inherit' });
}

function fileStats(p) {
  if (!p || !fs.existsSync(p)) return null;
  const buf = fs.readFileSync(p);
  return { bytes: buf.length, md5: crypto.createHash('md5').update(buf).digest('hex') };
}

function tileCounts(modulePath) {
  const src = fs.readFileSync(modulePath, 'utf8');
  const m = /export const TILE = (.*);\s*$/s.exec(src);
  if (!m) return null;
  const tile = JSON.parse(m[1]);
  return {
    blocks: tile.blocks?.length ?? 0,
    parcels: (tile.parcels || []).length,
    parks: tile.parks?.length ?? 0,
    water: tile.water?.length ?? 0,
    roads: tile.roads?.length ?? 0,
    landmarks: Object.keys(tile.landmarks || {}).length,
  };
}

function applyHash(tile, modulePath) {
  const st = fileStats(modulePath);
  tile.bytes = st?.bytes ?? null;
  tile.md5 = st?.md5 ?? null;
  tile.counts = st ? tileCounts(modulePath) : null;
  tile.status = st ? 'ready' : 'failed';
  if (!st) tile.error = 'module not written';
}

function cmdBuild(ids, { fetch = true } = {}) {
  const mf = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  fs.mkdirSync(MODULE_DIR, { recursive: true });
  for (const id of ids) {
    const tile = mf.tiles.find((t) => t.id === id);
    if (!tile) throw new Error(`unknown tile ${id}`);
    const outDir = path.join(DATA, 'tiles', id);
    fs.mkdirSync(outDir, { recursive: true });
    log(`=== tile ${id} — ${tile.label} (${tile.areaKm2} km², fetch ${tile.fetch.join(',')})`);
    try {
      if (fetch) run('bash', ['tools/madrid/fetch.sh', outDir], { MADRID_TILE: id });
      run(process.execPath, ['--max-old-space-size=4096', 'tools/madrid/build.mjs', tile.module], { MADRID_TILE: id, MADRID_DATA: outDir });
      applyHash(tile, path.join(ROOT, tile.module));
      tile.error = null;
      log(`tile ${id}: ${tile.bytes} B, ${JSON.stringify(tile.counts)}`);
    } catch (err) {
      tile.status = 'failed';
      tile.error = String(err.message || err).slice(0, 400);
      log(`tile ${id} FAILED: ${tile.error}`);
    }
    const ready = mf.tiles.filter((t) => t.status === 'ready');
    mf.totals = {
      tiles: mf.tiles.length,
      ready: ready.length,
      pending: mf.tiles.filter((t) => t.status === 'pending').length,
      failed: mf.tiles.filter((t) => t.status === 'failed').length,
      readyBytes: ready.reduce((n, t) => n + (t.bytes || 0) + (t.blocksBytes || 0), 0),
      readyKm2: Math.round(ready.reduce((n, t) => n + (t.areaKm2 || 0), 0) * 100) / 100,
    };
    fs.writeFileSync(MANIFEST, `${JSON.stringify(mf, null, 1)}\n`);
  }
}

// Counts of the seed's split modules (blocks + parcels), recorded in the manifest like a tile's.
function seedCounts(blocksPath) {
  const src = fs.readFileSync(blocksPath, 'utf8');
  const blocks = JSON.parse(/export const BLOCKS = (.*?);\n/s.exec(src)[1]);
  const parcels = JSON.parse(/export const PARCELS = (.*?);\n/s.exec(src)[1]);
  return { blocks: blocks.length, parcels: parcels.reduce((n, list) => n + list.length, 0) };
}

function cmdBuildSeed({ fetch = true } = {}) {
  const mf = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const seed = mf.tiles.find((t) => t.id === SEED);
  const outDir = DATA;
  log('=== seed tile fase2 (phase-2 box, refetched with the 100 m overlap so its seams are whole)');
  if (fetch) run('bash', ['tools/madrid/fetch.sh', outDir], { MADRID_TILE: SEED });
  run(process.execPath, ['--max-old-space-size=4096', 'tools/madrid/build.mjs', seed.module], { MADRID_TILE: SEED, MADRID_DATA: outDir });
  applyHash(seed, path.join(ROOT, seed.module));
  const st = fileStats(path.join(ROOT, seed.blocksModule));
  seed.blocksBytes = st?.bytes ?? null;
  seed.blocksMd5 = st?.md5 ?? null;
  try { seed.counts = seedCounts(path.join(ROOT, seed.blocksModule)); } catch { seed.counts = null; }
  fs.writeFileSync(MANIFEST, `${JSON.stringify(mf, null, 1)}\n`);
  log(`seed: ${seed.bytes} B + ${seed.blocksBytes} B`);
}

function cmdFetchM30() {
  const url = 'https://overpass-api.de/api/interpreter';
  const query = '[out:json][timeout:120];(way["ref"="M-30"];relation["ref"="M-30"];);out geom;';
  const out = path.join(DATA, 'm30.json');
  const mirrors = [url, 'https://overpass.osm.ch/api/interpreter', 'https://overpass.openstreetmap.fr/api/interpreter'];
  for (const ep of mirrors) {
    try {
      const res = execFileSync('curl', ['-sS', '-m', '600', '-A', 'slop-madrid/1.0 (three.js city sim)', '--data-urlencode', `data=${query}`, '-w', '%{http_code}', '-o', out, ep], { encoding: 'utf8' });
      const data = JSON.parse(fs.readFileSync(out, 'utf8'));
      if (res.trim().endsWith('200') && Array.isArray(data.elements) && data.elements.length) {
        log(`m30: ${data.elements.length} ways from ${ep} -> ${out}`);
        return;
      }
    } catch { /* next mirror */ }
  }
  throw new Error('every Overpass mirror failed for the M-30 ring');
}

function cmdVerify() {
  const mf = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  let bad = 0;
  for (const t of mf.tiles) {
    if (t.status !== 'ready') continue;
    for (const [mod, md5, bytes] of [[t.module, t.md5, t.bytes], [t.blocksModule, t.blocksMd5, t.blocksBytes]]) {
      if (!mod) continue;
      const st = fileStats(path.join(ROOT, mod));
      if (!st || st.md5 !== md5 || st.bytes !== bytes) {
        log(`MISMATCH ${t.id} ${mod}: manifest ${bytes}/${md5} vs file ${st?.bytes}/${st?.md5}`);
        bad++;
      }
    }
  }
  log(bad ? `${bad} mismatched module(s)` : `verify ok: ${mf.totals.ready}/${mf.totals.tiles} tiles ready, ${(mf.totals.readyBytes / 1048576).toFixed(2)} MB`);
  if (bad) process.exitCode = 1;
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'manifest') {
  const prev = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : null;
  const mf = manifest(prev);
  fs.writeFileSync(MANIFEST, `${JSON.stringify(mf, null, 1)}\n`);
  log(`wrote ${path.relative(ROOT, MANIFEST)}: ${mf.totals.tiles} tiles (${mf.totals.ready} ready, ${mf.totals.pending} pending)`);
} else if (cmd === 'build') {
  cmdBuild(rest.filter((a) => !a.startsWith('--')), { fetch: !rest.includes('--no-fetch') });
} else if (cmd === 'build-seed') {
  cmdBuildSeed({ fetch: !rest.includes('--no-fetch') });
} else if (cmd === 'fetch-m30') {
  cmdFetchM30();
} else if (cmd === 'verify') {
  cmdVerify();
} else {
  console.error('usage: node tools/madrid/tiles.mjs manifest|build <ids...>|build-seed|fetch-m30|verify');
  process.exitCode = 2;
}
