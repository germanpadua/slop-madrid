const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

// Phase-3 contract: the M-30 manifest covers the almendra with disjoint 1 km cores, every generated tile is a real,
// hash-pinned module whose building blocks are whole (never cut at a tile seam), the tiles never carry the same
// parcel twice, and the streaming policy keeps the resident geodata inside its memory budget.

const root = join(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'tools/madrid/tiles.json'), 'utf8'));
let planTiles, distanceToCore, TILE_BUDGET;
let projection;

test.before(async () => {
  ({ planTiles, distanceToCore, TILE_BUDGET } = await import('../js/madrid-tiles.js'));
  projection = await import('../tools/madrid/projection.mjs');
});

const readyTiles = () => manifest.tiles.filter((t) => t.status === 'ready');
const areaOfRect = ([x0, z0, x1, z1]) => (x1 - x0) * (z1 - z0);
const rectWorld = ([x0, y0, x1, y1]) => [x0 - projection.SOLX, projection.SOLY - y1, x1 - projection.SOLX, projection.SOLY - y0];
const ringsOverlap = (a, b) => a[0] < b[2] - 0.01 && a[2] > b[0] + 0.01 && a[1] < b[3] - 0.01 && a[3] > b[1] + 0.01;
const insideRect = ([x, z], [x0, z0, x1, z1], tol = 1) => x >= x0 - tol && x <= x1 + tol && z >= z0 - tol && z <= z1 + tol;
const ringDistance = (ring, x, z) => {
  let best = Infinity;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[j], az = ring[j + 1], bx = ring[i], bz = ring[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    best = Math.min(best, Math.hypot(ax + t * dx - x, az + t * dz - z));
  }
  return best;
};
const insideRing = (ring, x, z) => {
  let hit = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    // rings are stored flat ([x0, z0, x1, z1, ...]) as well as nested ([[x, z], ...])
    const ax = Array.isArray(ring[j]) ? ring[j][0] : ring[j];
    const az = Array.isArray(ring[j]) ? ring[j][1] : ring[j + 1];
    const bx = Array.isArray(ring[i]) ? ring[i][0] : ring[i];
    const bz = Array.isArray(ring[i]) ? ring[i][1] : ring[i + 1];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) hit = !hit;
  }
  return hit;
};
const ringArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) a += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
  return Math.abs(a) / 2;
};
const md5 = (file) => createHash('md5').update(readFileSync(file)).digest('hex');

test('the manifest is the whole M-30 interior: a real ring, ~50 km², with every cell of it owned', () => {
  assert.equal(manifest.version, 1);
  assert.equal(manifest.crs, 'EPSG:25830');
  assert.equal(manifest.grid.cell, 1000);
  assert.equal(manifest.grid.overlap, 100);
  const { ring, areaKm2 } = manifest.almendra;
  assert.ok(ring.length >= 40, `almendra boundary has real detail (${ring.length} vertices)`);
  const ringAreaM2 = ringArea(ring.flat());
  assert.ok(Math.abs(ringAreaM2 / 1e6 - areaKm2) < 1, 'manifest area matches its own ring');
  // The interior of the M-30, as geometry: it contains the centre and reaches the Retiro, Atocha, Chamartín & the south.
  assert.ok(areaKm2 > 30 && areaKm2 < 70, `M-30 interior area ${areaKm2} km²`);
  assert.ok(insideRing(ring.flat(), 0, 0), 'Puerta del Sol is inside');
  assert.ok(insideRing(ring.flat(), 1900, 100), 'the Retiro is inside');
  assert.ok(insideRing(ring.flat(), 900, 1300), 'the south (Arganzuela) is inside');
  assert.ok(insideRing(ring.flat(), 900, -2100), 'Chamartín is inside');
  assert.ok(!insideRing(ring.flat(), 6000, 0), 'Puente de Vallecas is outside');
  assert.ok(manifest.almendra.capZ < -6000, 'the north cap is the M-30 ring apex, not the whole radial corridor');
});

test('tile cores are disjoint and cover the M-30 interior (no hole, no double ownership)', () => {
  const all = manifest.tiles.flatMap((t) => t.core.map((r) => ({ tile: t.id, r })));
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      assert.ok(!ringsOverlap(all[i].r, all[j].r), `cores ${all[i].tile} and ${all[j].tile} do not overlap`);
    }
  }
  // Sample the interior: every point inside the M-30 ring must fall in exactly one tile core.
  const ring = manifest.almendra.ring.flat();
  const xs = ring.filter((_, i) => i % 2 === 0), zs = ring.filter((_, i) => i % 2 === 1);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  let samples = 0, holes = 0;
  for (let x = x0; x <= x1; x += 125) {
    for (let z = z0; z <= z1; z += 125) {
      if (!insideRing(ring, x, z)) continue;
      samples++;
      const owners = manifest.tiles.filter((t) => t.core.some((r) => insideRect([x, z], r, 0)));
      if (owners.length !== 1) holes++;
    }
  }
  assert.ok(samples > 2000, `sampled ${samples} interior points`);
  assert.equal(holes, 0, `every interior point has exactly one owning tile (${holes} bad)`);
  const covered = manifest.tiles.reduce((n, t) => n + t.core.reduce((a, r) => a + areaOfRect(r), 0), 0) / 1e6;
  assert.ok(covered > manifest.almendra.areaKm2 * 0.95, `cores cover ${covered.toFixed(1)} km² of ${manifest.almendra.areaKm2} km²`);
});

test('phase-3 tiles are generated, hashed and listed with their area', () => {
  const expected = ['k3j1', 'k4j1', 'k4j2', 'k2j-1', 'k0j-1', 'k0j3', 'k2j4'];
  for (const id of expected) {
    const t = manifest.tiles.find((x) => x.id === id);
    assert.ok(t, `tile ${id} is in the manifest`);
    assert.equal(t.status, 'ready', `tile ${id} is ready`);
    assert.ok(t.areaKm2 > 0.5 && t.areaKm2 <= 1, `tile ${id} area ${t.areaKm2} km²`);
    assert.ok(t.module === `js/geodata/tile-${id}.js`);
    assert.ok(Array.isArray(t.bboxWgs84) && t.bboxWgs84.length === 4);
  }
  // Every ready tile's module exists at the recorded size and hash (the manifest is the deploy contract).
  for (const t of readyTiles()) {
    const file = join(root, t.module);
    assert.ok(existsSync(file), `${t.module} exists`);
    assert.equal(statSync(file).size, t.bytes, `${t.module} size`);
    assert.equal(md5(file), t.md5, `${t.module} md5`);
    if (t.blocksModule) {
      const blocks = join(root, t.blocksModule);
      assert.equal(statSync(blocks).size, t.blocksBytes, `${t.blocksModule} size`);
      assert.equal(md5(blocks), t.blocksMd5, `${t.blocksModule} md5`);
    }
  }
  const bytes = readyTiles().reduce((n, t) => n + (t.bytes || 0) + (t.blocksBytes || 0), 0);
  assert.ok(bytes <= manifest.budget.maxResidentBytes, `ready tiles fit the ${manifest.budget.maxResidentBytes} B budget (${bytes} B)`);
});

test('tile modules carry their own real geodata, owned by their core', () => {
  for (const t of readyTiles().filter((x) => x.module.includes('/geodata/'))) {
    const src = readFileSync(join(root, t.module), 'utf8');
    const m = /export const TILE = (.*);\s*$/s.exec(src);
    assert.ok(m, `${t.module} exports TILE`);
    const TILE = JSON.parse(m[1]);
    assert.equal(TILE.id, t.id);
    assert.deepEqual(TILE.core, t.core);
    assert.ok(TILE.blocks.length >= 10, `${t.id}: ${TILE.blocks.length} real block slabs`);
    assert.ok(TILE.parcels.length > 300, `${t.id}: cadastral parcels`);
    assert.ok(TILE.parks.length > 0, `${t.id}: real parks`);
    for (const [ring] of TILE.blocks) assert.ok(ring.length >= 6, `${t.id}: block outline`);
    for (const p of TILE.parcels) assert.ok(p.h >= 2.4 && p.h <= 250, `${t.id}: parcel height ${p.h} m is real`);
  }
});

test('no block or building is cut at a tile seam', () => {
  for (const t of readyTiles().filter((x) => x.module.includes('/geodata/'))) {
    const TILE = JSON.parse(/export const TILE = (.*);\s*$/s.exec(readFileSync(join(root, t.module), 'utf8'))[1]);
    const fetchBox = rectWorld(t.fetch);
    const badBlocks = TILE.blocks.filter(([ring]) => {
      for (let i = 0; i < ring.length; i += 2) if (!insideRect([ring[i], ring[i + 1]], fetchBox, 0.6)) return true;
      return false;
    });
    assert.equal(badBlocks.length, 0, `${t.id}: every block slab is whole inside the tile fetch box (${badBlocks.length} clipped)`);
    let checked = 0;
    for (const p of TILE.parcels) {
      checked++;
      let cx = 0, cz = 0;
      for (let i = 0; i < p.ring.length; i += 2) { cx += p.ring[i]; cz += p.ring[i + 1]; }
      cx /= p.ring.length / 2; cz /= p.ring.length / 2;
      // Owned either by its centre (in this core) or by the block it belongs to (rendered whole, seam included).
      const inCore = t.core.some((r) => insideRect([cx, cz], r, 0.5));
      // (2.5 m: the block outline is simplified, see tools/madrid/build.mjs SEAM_TOL)
      const inBlock = TILE.blocks.some(([ring]) => insideRing(ring, cx, cz) || ringDistance(ring, cx, cz) <= 2.5);
      assert.ok(inCore || inBlock, `${t.id}: parcel owned by this core or by one of its blocks`);
      // A cut footprint would carry at least two vertices along one clipping line (the fetch box edge).
      for (const [minX, maxX, minZ, maxZ] of [fetchBox]) {
        for (const side of [
          p.ring.filter((_, i) => i % 2 === 0 && Math.abs(p.ring[i] - minX) < 0.15).length,
          p.ring.filter((_, i) => i % 2 === 0 && Math.abs(p.ring[i] - maxX) < 0.15).length,
          p.ring.filter((_, i) => i % 2 === 1 && Math.abs(p.ring[i] - minZ) < 0.15).length,
          p.ring.filter((_, i) => i % 2 === 1 && Math.abs(p.ring[i] - maxZ) < 0.15).length
        ]) assert.ok(side < 2, `${t.id}: parcel footprint is whole, not clipped by the fetch box`);
      }
    }
    assert.ok(checked > 300, `${t.id}: ${checked} complete footprints`);
  }
});

test('tiles dedupe each other: no parcel or block is carried by two tiles', () => {
  const seenParcel = new Map(), seenBlock = new Map();
  for (const t of readyTiles().filter((x) => x.module.includes('/geodata/'))) {
    const TILE = JSON.parse(/export const TILE = (.*);\s*$/s.exec(readFileSync(join(root, t.module), 'utf8'))[1]);
    for (const p of TILE.parcels) {
      const key = p.ring.join(',');
      assert.ok(!seenParcel.has(key), `${t.id} repeats a parcel from ${seenParcel.get(key)}`);
      seenParcel.set(key, t.id);
    }
    for (const [ring] of TILE.blocks) {
      const key = ring.join(',');
      assert.ok(!seenBlock.has(key), `${t.id} repeats a block from ${seenBlock.get(key)}`);
      seenBlock.set(key, t.id);
    }
  }
  assert.ok(seenParcel.size > 2000, `${seenParcel.size} unique parcels across the generated tiles`);
});

test('streaming prefetches around the camera, evicts far tiles and never drops the seed', () => {
  const mk = (id, coreRect, bytes = 500 * 1024) => ({ id, status: 'ready', core: [coreRect], bytes });
  const seeded = () => new Map([[ 'fase2', { bytes: 4 * 1024 * 1024 } ]]);
  const tiles = [
    mk('fase2', [-500, -500, 500, 500], 4 * 1024 * 1024),
    mk('near', [1500, -500, 2500, 500]),
    mk('far', [5000, -500, 6000, 500]),
    { id: 'pending', status: 'pending', core: [[700, -500, 1400, 500]], bytes: 0 }
  ];
  // from the seed: the near tile (1 000 m away) is prefetched, the far one (4 500 m) and the pending one are not
  let plan = planTiles({ tiles, loaded: seeded(), x: 0, z: 0, bytes: 4 * 1024 * 1024 });
  assert.deepEqual(plan.load, ['near']);
  // standing on the near tile: nothing left to fetch, the far tile stays out
  plan = planTiles({ tiles, loaded: new Map([...seeded(), ['near', { bytes: 500 * 1024 }]]), x: 1500, z: 0, bytes: 4.5 * 1024 * 1024 });
  assert.deepEqual(plan.load, []);
  // 5.5 km away the near tile is beyond the drop radius (released) and the far tile is entered (prefetched)
  plan = planTiles({ tiles, loaded: new Map([...seeded(), ['near', { bytes: 500 * 1024 }]]), x: 5500, z: 0, bytes: 4.5 * 1024 * 1024 });
  assert.deepEqual(plan.drop, ['near']);
  assert.deepEqual(plan.load, ['far']);
  assert.ok(distanceToCore(tiles[1], 5500, 0) > TILE_BUDGET.dropRadius);
  // the seed is never evicted, whatever the distance
  plan = planTiles({ tiles, loaded: seeded(), x: 20000, z: 0, bytes: 4 * 1024 * 1024 });
  assert.ok(!plan.drop.includes('fase2'));
});

test('speed-aware look-ahead prefetches along the velocity, not behind it (tinywarsaw engine notes)', () => {
  const mk = (id, coreRect, bytes = 500 * 1024) => ({ id, status: 'ready', core: [coreRect], bytes });
  const seeded = () => new Map([[ 'fase2', { bytes: 4 * 1024 * 1024 } ]]);
  const tiles = [
    mk('fase2', [-500, -500, 500, 500], 4 * 1024 * 1024),
    mk('ahead', [3500, -500, 4500, 500]),   // 3 000 m east of the camera
    mk('behind', [-4500, -500, -3500, 500]) // 3 000 m west of the camera
  ];
  // parked at the origin: both are outside the 1 600 m preload radius, nothing loads
  let plan = planTiles({ tiles, loaded: seeded(), x: 0, z: 0, bytes: 4 * 1024 * 1024 });
  assert.deepEqual(plan.load, []);
  // flying east at 400 m/s: the 6 s look-ahead (clamped to 1.5x the radius, 2 400 m) pulls 'ahead' into range,
  // while 'behind' stays out — a flight never frames an unbuilt tile on its path
  plan = planTiles({ tiles, loaded: seeded(), x: 0, z: 0, vx: 400, vz: 0, bytes: 4 * 1024 * 1024 });
  assert.deepEqual(plan.load, ['ahead']);
  // flying west: the mirror image
  plan = planTiles({ tiles, loaded: seeded(), x: 0, z: 0, vx: -400, vz: 0, bytes: 4 * 1024 * 1024 });
  assert.deepEqual(plan.load, ['behind']);
  // eviction still measures from the true position: a tile left 3 km behind is dropped mid-flight
  plan = planTiles({ tiles, loaded: new Map([...seeded(), ['behind', { bytes: 500 * 1024 }]]), x: 0, z: 0, vx: 400, vz: 0, bytes: 4.5 * 1024 * 1024 });
  assert.deepEqual(plan.drop, ['behind']);
});

test('the memory budget is a hard cap: the resident set never exceeds it', () => {
  const tiles = [0, 1, 2, 3, 4, 5].map((i) => ({
    id: `t${i}`, status: 'ready', core: [[i * 400, -500, i * 400 + 800, 500]], bytes: 3 * 1024 * 1024
  }));
  const budget = { maxResidentBytes: 7 * 1024 * 1024, maxResidentTiles: 12 };
  let loaded = new Map();
  let resident = 0;
  for (let step = 0; step < 4; step++) {
    const plan = planTiles({ tiles, loaded, x: step * 400, z: 0, bytes: resident, budget });
    for (const id of plan.drop) {
      loaded.delete(id);
      resident -= tiles.find((t) => t.id === id).bytes;
    }
    for (const id of plan.load) {
      loaded.set(id, { bytes: tiles.find((t) => t.id === id).bytes });
      resident += tiles.find((t) => t.id === id).bytes;
      assert.ok(resident <= budget.maxResidentBytes, `resident ${resident} B within budget`);
    }
  }
  assert.ok(loaded.size >= 2, 'nearby tiles are still streamed in under the cap');
  // tile-count cap is enforced too (farthest resident tiles go first)
  const many = new Map(tiles.map((t) => [t.id, { bytes: t.bytes }]));
  const plan = planTiles({ tiles, loaded: many, x: 0, z: 0, bytes: 18 * 1024 * 1024, budget: { maxResidentBytes: 100 * 1024 * 1024, maxResidentTiles: 3 } });
  assert.ok(many.size - plan.drop.length <= 3, `${many.size - plan.drop.length} tiles left for a cap of 3`);
});

test('budget constants match the phase-3 target (~12 MB of resident geodata)', () => {
  assert.equal(TILE_BUDGET.maxResidentBytes, 12 * 1024 * 1024);
  assert.ok(TILE_BUDGET.dropRadius > TILE_BUDGET.preloadRadius);
  assert.equal(manifest.budget.maxResidentBytes, TILE_BUDGET.maxResidentBytes);
});

test('madrid facade palettes are Madrid, not Manhattan', async () => {
  const { MADRID_FACADE_OPTS, MADRID_PARCEL_FACE } = await import('../js/madrid-tiles.js');
  assert.equal(MADRID_FACADE_OPTS.length, 3);
  // Manhattan table uses 2.2-2.6 m bays and 3.4-3.5 m floors; Madrid blocks use ~1.4-1.6 m bays (balcones)
  // and 3.1-3.4 m floors.
  for (const o of MADRID_FACADE_OPTS) {
    assert.ok(o.windowWidth <= 1.6, `bay too wide: ${o.windowWidth}`);
    assert.ok(o.floorHeight >= 3.0 && o.floorHeight <= 3.4, `floor out of range: ${o.floorHeight}`);
    assert.ok(typeof o.stoneColor === 'number' && typeof o.trimColor === 'number' && typeof o.windowGlassColor === 'number');
  }
  const stones = new Set(MADRID_FACADE_OPTS.map((o) => o.stoneColor));
  assert.equal(stones.size, 3, 'palettes must be distinct');
  assert.equal(MADRID_PARCEL_FACE, 'entry');
});

test('landmark styles match named monuments, not blanket tones', async () => {
  const { MADRID_LANDMARK_STYLES } = await import('../js/madrid-tiles.js');
  const match = (name) => MADRID_LANDMARK_STYLES.find(([re]) => re.test(name));
  assert.ok(match('Palacio Real de Madrid'));
  assert.ok(match('Catedral de la Almudena'));
  assert.ok(match('Puerta de Alcalá'));
  assert.ok(match('Edificio Metrópolis'));
  assert.ok(!match('Monumento al General Vara de Rey y Héroes del Caney'), 'unlisted monuments keep the default');
  const colors = new Set(MADRID_LANDMARK_STYLES.map(([, s]) => s.color));
  assert.ok(colors.size >= 4, 'styles must not collapse into one blanket color');
});
