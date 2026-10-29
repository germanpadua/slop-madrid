// js/monumentos.js — real municipal monument meshes, streamed like the phase-3 tiles.
//
// tools/madrid/monumentos.json lists the generated modules (js/monumentos/m-<id>.js), their world bounds, byte size
// and the geodata tile that owns them. A monument is imported only while its tile is resident *and* the camera is
// close enough; it is disposed when the tile is evicted or the camera leaves. Geometry construction lives in
// js/monument-mesh.js (three), this module keeps the policy pure so it can be tested without a renderer.
export const MONUMENT_BUDGET = Object.freeze({
  maxResidentBytes: 2 * 1024 * 1024,
  preloadRadius: 1000,
  dropRadius: 1600
});

/** Distance (m) from a world point to a monument's bounds [x0, z0, x1, z1]. */
export function distanceToMonument(monument, x, z) {
  const b = monument.bounds;
  if (!b || b.length < 4) return Infinity;
  const dx = Math.max(Math.min(b[0], b[2]) - x, 0, x - Math.max(b[0], b[2]));
  const dz = Math.max(Math.min(b[1], b[3]) - z, 0, z - Math.max(b[1], b[3]));
  return Math.hypot(dx, dz);
}

/**
 * Pure load/evict decision for one camera position.
 * @param {object} o
 * @param {Array<{id:string,bounds:number[],bytes:number,tile:string}>} o.monuments
 * @param {Map<string,{bytes:number}>|Set<string>} o.loaded
 * @param {Set<string>|((tile:string)=>boolean)} o.resident  tiles currently in the world
 * @param {number} o.x  camera x (east)
 * @param {number} o.z  camera z (south)
 * @param {number} [o.bytes]  monument bytes resident now
 * @param {object} [o.budget] MONUMENT_BUDGET fields, any subset
 * @returns {{load: string[], drop: string[], distances: Map<string, number>}}
 */
export function planMonuments({ monuments, loaded, resident, x, z, bytes = 0, budget = MONUMENT_BUDGET }) {
  const b = { ...MONUMENT_BUDGET, ...budget };
  const isResident = typeof resident === 'function'
    ? resident
    : (tile) => !resident || resident.has(tile);
  const distances = new Map();
  for (const m of monuments) distances.set(m.id, distanceToMonument(m, x, z));

  const drop = [];
  const dropped = new Set();
  let residentBytes = bytes;
  const evict = (m) => {
    drop.push(m.id);
    dropped.add(m.id);
    residentBytes -= m.bytes || 0;
  };

  // 1. Their tile is gone, or the camera left the drop radius (farthest first).
  const present = monuments.filter((m) => loaded.has(m.id) && !dropped.has(m.id));
  present.sort((p, q) => (distances.get(q.id) ?? Infinity) - (distances.get(p.id) ?? Infinity));
  for (const m of present) {
    if (!isResident(m.tile) || (distances.get(m.id) ?? Infinity) > b.dropRadius) evict(m);
  }
  // 2. Hard byte cap regardless of movement.
  for (const m of present) {
    if (residentBytes <= b.maxResidentBytes) break;
    if (!dropped.has(m.id)) evict(m);
  }
  // 3. Nearest resident-tile monuments inside the preload radius that fit, nearest first.
  const load = [];
  const candidates = monuments
    .filter((m) => !loaded.has(m.id) && !dropped.has(m.id) && isResident(m.tile)
      && (distances.get(m.id) ?? Infinity) <= b.preloadRadius)
    .sort((p, q) => (distances.get(p.id) ?? Infinity) - (distances.get(q.id) ?? Infinity));
  for (const m of candidates) {
    if (residentBytes + (m.bytes || 0) > b.maxResidentBytes) break;
    load.push(m.id);
    residentBytes += m.bytes || 0;
  }
  return { load, drop, distances };
}

/**
 * Runtime loader: fetches the manifest, imports monument modules on demand and adds them to the scene.
 * `importModule` and `buildMesh` are injectable so the policy can be exercised without a browser.
 */
export async function createMonumentLoader({
  scene,
  colliders = null,
  buildMesh,
  manifestUrl = './tools/madrid/monumentos.json',
  baseUrl = globalThis.document?.baseURI ?? './',
  budget = MONUMENT_BUDGET,
  importModule = (url) => import(url),
  fetchJson = async (url) => {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`monuments manifest ${res.status}`);
    return res.json();
  },
  isTileResident = () => true,
  onStatus = null
} = {}) {
  if (typeof buildMesh !== 'function') throw new Error('createMonumentLoader needs buildMesh');
  const budgetCfg = { ...MONUMENT_BUDGET, ...(budget || {}) };
  const manifest = await fetchJson(new URL(manifestUrl, baseUrl).href);
  const monuments = (manifest.monuments || []).filter((m) => m.module && m.id);
  const loaded = new Map();
  const failures = new Map();
  const inFlight = new Set();
  let lastX = Infinity;
  let lastZ = Infinity;
  let lastAt = -Infinity;

  const status = () => ({
    loaded: [...loaded.keys()],
    bytes: [...loaded.values()].reduce((n, v) => n + (v.bytes || 0), 0),
    failures: failures.size,
    available: monuments.length
  });

  async function loadMonument(id) {
    const meta = monuments.find((m) => m.id === id);
    if (!meta || loaded.has(id) || inFlight.has(id) || (failures.get(id) || 0) >= 2) return;
    inFlight.add(id);
    try {
      const url = new URL(`${meta.module}?v=${meta.md5 || '0'}`, baseUrl).href;
      const mod = await importModule(url);
      const data = mod.MONUMENT;
      if (!data || data.id !== id) throw new Error(`${meta.module} does not export MONUMENT ${id}`);
      const built = buildMesh({ ...data, bytes: meta.bytes || 0 });
      built.group.userData.bytes = meta.bytes || 0;
      scene.add(built.group);
      if (colliders) colliders.push(...built.colliders);
      loaded.set(id, { built, bytes: meta.bytes || 0 });
      console.info(`[monumentos] +${id} ${meta.triangles} tris ${meta.bytes} B`);
      onStatus?.(status());
    } catch (err) {
      failures.set(id, (failures.get(id) || 0) + 1);
      console.warn(`[monumentos] ${id} unavailable: ${err.message}`);
      onStatus?.(status());
    } finally {
      inFlight.delete(id);
    }
  }

  function dropMonument(id) {
    const entry = loaded.get(id);
    if (!entry) return;
    scene.remove(entry.built.group);
    entry.built.mesh.geometry.dispose();
    entry.built.mesh.material.dispose();
    if (colliders) {
      const drop = new Set(entry.built.colliders);
      for (let i = colliders.length - 1; i >= 0; i--) if (drop.has(colliders[i])) colliders.splice(i, 1);
    }
    loaded.delete(id);
    console.info(`[monumentos] -${id}`);
    onStatus?.(status());
  }

  /** Call every frame; self-throttles to 10 m / 500 ms. */
  function update(x, z, now = performance.now()) {
    const moved = Math.hypot(x - lastX, z - lastZ);
    if (moved < 10 && now - lastAt < 500) return null;
    lastX = x;
    lastZ = z;
    lastAt = now;
    const plan = planMonuments({
      monuments,
      loaded,
      resident: isTileResident,
      x,
      z,
      bytes: [...loaded.values()].reduce((n, v) => n + (v.bytes || 0), 0),
      budget: budgetCfg
    });
    for (const id of plan.drop) dropMonument(id);
    for (const id of plan.load) loadMonument(id);
    return plan;
  }

  function disposeAll() {
    for (const id of [...loaded.keys()]) dropMonument(id);
  }

  return {
    manifest,
    monuments,
    missing: manifest.missing || [],
    update,
    loadMonument,
    dropMonument,
    has: (id) => loaded.has(id),
    ids: () => [...loaded.keys()],
    status,
    disposeAll,
    budget: budgetCfg
  };
}
