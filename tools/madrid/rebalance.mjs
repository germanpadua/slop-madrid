// tools/madrid/rebalance.mjs — local parcel de-duplication across the seed and ready tiles, no refetch.
//
// A footprint must be emitted by exactly one module. Tiles built with the centre rule (build.mjs, 28-10-2026)
// own every footprint whose centre their core holds; older modules (seed, 27-10 tiles) can emit the same ring
// through the old block-ownership rule. This pass enforces uniqueness on the GENERATED modules:
//   - a ring emitted by several modules is kept only in the module whose core holds its centre;
//   - if that module does not have it, it is moved there (appended; parcels are plain {ring, h});
//   - a ring whose centre is in no ready core (overlap into pending cells) keeps its first carrier.
// Singletons are never moved: coverage may not regress. Manifest md5/bytes are refreshed at the end.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST = path.join(ROOT, 'tools/madrid/tiles.json');
const mf = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

const inRects = (rects, x, z) => rects.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
const center = (ring) => {
  let cx = 0, cz = 0;
  for (let i = 0; i < ring.length; i += 2) { cx += ring[i]; cz += ring[i + 1]; }
  return [cx / (ring.length / 2), cz / (ring.length / 2)];
};

// Load carriers: the seed (PARCELS groups) and every ready tile (TILE.parcels).
const carriers = [];
for (const t of mf.tiles.filter((t) => t.status === 'ready')) {
  if (t.id === 'fase2') {
    const file = path.join(ROOT, 'js/madrid-geodata-blocks.js');
    const src = fs.readFileSync(file, 'utf8');
    const groups = JSON.parse(/export const PARCELS = (.*?);\n/s.exec(src)[1]);
    carriers.push({ id: t.id, core: t.core, file, kind: 'seed', groups });
  } else {
    const file = path.join(ROOT, t.module);
    const src = fs.readFileSync(file, 'utf8');
    const tile = JSON.parse(/export const TILE = (.*);\s*$/s.exec(src)[1]);
    carriers.push({ id: t.id, core: t.core, file, kind: 'tile', tile });
  }
}
const ownerOf = (x, z) => carriers.find((c) => inRects(c.core, x, z));

// Index every parcel occurrence.
const byKey = new Map(); // ringKey -> [{carrier, parcel}]
for (const c of carriers) {
  const list = c.kind === 'seed' ? c.groups.flat() : c.tile.parcels;
  for (const p of list) {
    const k = p.ring.join(',');
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push({ carrier: c, parcel: p });
  }
}

let moved = 0, deduped = 0;
const removeFrom = (c, key) => {
  if (c.kind === 'seed') c.groups = c.groups.map((g) => g.filter((p) => p.ring.join(',') !== key));
  else c.tile.parcels = c.tile.parcels.filter((p) => p.ring.join(',') !== key);
};
const addTo = (c, parcel) => {
  if (c.kind === 'seed') c.groups.push([parcel]); // own group: not tied to a seed block's massing
  else c.tile.parcels.push(parcel);
};

for (const [key, occ] of byKey) {
  if (occ.length < 2) continue;
  const [x, z] = center(occ[0].parcel.ring);
  const owner = ownerOf(x, z);
  const keep = (owner && occ.find((o) => o.carrier === owner)) || (owner ? null : occ[0]);
  if (!keep) {
    // duplicated ring whose owner module lacks it: move the first copy to the owner
    addTo(owner, occ[0].parcel);
    for (const o of occ) removeFrom(o.carrier, key);
    moved++;
  } else {
    for (const o of occ) if (o.carrier !== keep.carrier) { removeFrom(o.carrier, key); deduped++; }
  }
}

// Sliver drop: a tiny parcel (< 25 m2) almost fully covered (>= 90% of sampled area) by a
// bigger parcel (> 3x area) in ANOTHER carrier is a seam-split residue: the straddling source
// volume is kept whole on the side holding most of it, and the sliver only z-fights with it.
// Cross-carrier coverage only - intra-module overlaps (annexes) are out of scope.
const ringArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j] * r[i + 1] - r[i] * r[j + 1];
  return Math.abs(a / 2);
};
const pip = (ring, x, z) => {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const bbox = (r) => {
  const xs = r.filter((_, i) => i % 2 === 0), zs = r.filter((_, i) => i % 2 === 1);
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
};
const allParcels = [];
for (const c of carriers) {
  const list = c.kind === 'seed' ? c.groups.flat() : c.tile.parcels;
  for (const p of list) allParcels.push({ carrier: c, parcel: p, bb: bbox(p.ring), area: ringArea(p.ring) });
}
let slivers = 0;
for (const e of allParcels) {
  if (e.area >= 25) continue;
  const [x0, z0, x1, z1] = e.bb;
  const coverers = allParcels.filter((o) => o.carrier !== e.carrier && o.area > 3 * e.area &&
    o.bb[0] <= x1 && o.bb[2] >= x0 && o.bb[1] <= z1 && o.bb[3] >= z0);
  if (!coverers.length) continue;
  let inside = 0, total = 0;
  for (let x = x0; x <= x1; x += 0.5) for (let z = z0; z <= z1; z += 0.5) {
    if (!pip(e.parcel.ring, x, z)) continue;
    total++;
    if (coverers.some((o) => pip(o.parcel.ring, x, z))) inside++;
  }
  if (total && inside / total >= 0.9) {
    removeFrom(e.carrier, e.parcel.ring.join(','));
    slivers++;
    console.log(`  sliver dropped from ${e.carrier.id}: ${e.area.toFixed(1)} m2, ${(100 * inside / total).toFixed(0)}% covered`);
  }
}

// Write back, preserving each generated file around the replaced JSON.
for (const c of carriers) {
  let src = fs.readFileSync(c.file, 'utf8');
  if (c.kind === 'seed') {
    src = src.replace(/export const PARCELS = .*?;\n/s, `export const PARCELS = ${JSON.stringify(c.groups)};\n`);
  } else {
    const tileJson = JSON.stringify(c.tile);
    src = src.replace(/export const TILE = .*;\s*$/s, `export const TILE = ${tileJson};\n`);
  }
  fs.writeFileSync(c.file, src);
}

// Refresh manifest md5/bytes/counts for every ready entry (seed: both modules).
const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
for (const t of mf.tiles.filter((t) => t.status === 'ready')) {
  if (t.id === 'fase2') {
    const a = path.join(ROOT, 'js/madrid-geodata.js'), b = path.join(ROOT, 'js/madrid-geodata-blocks.js');
    t.md5 = md5(a); t.bytes = fs.statSync(a).size;
    t.blocksMd5 = md5(b); t.blocksBytes = fs.statSync(b).size;
    const c = carriers.find((x) => x.id === 'fase2');
    t.counts.parcels = c.groups.reduce((n, g) => n + g.length, 0);
  } else {
    const f = path.join(ROOT, t.module);
    t.md5 = md5(f); t.bytes = fs.statSync(f).size;
    const c = carriers.find((x) => x.id === t.id);
    t.counts.parcels = c.tile.parcels.length;
  }
}
const ready = mf.tiles.filter((t) => t.status === 'ready');
mf.totals = {
  tiles: mf.tiles.length,
  ready: ready.length,
  pending: mf.tiles.filter((t) => t.status === 'pending').length,
  failed: mf.tiles.filter((t) => t.status === 'failed').length,
  readyBytes: ready.reduce((n, t) => n + (t.bytes || 0) + (t.blocksBytes || 0), 0),
  readyKm2: Math.round(ready.reduce((n, t) => n + (t.areaKm2 || 0), 0) * 100) / 100
};
fs.writeFileSync(MANIFEST, `${JSON.stringify(mf, null, 1)}\n`);
console.log(`rebalance: ${deduped} duplicate copies removed, ${moved} parcels moved to their centre's owner, ${slivers} seam slivers dropped`);
for (const c of carriers) {
  const n = c.kind === 'seed' ? c.groups.reduce((x, g) => x + g.length, 0) : c.tile.parcels.length;
  console.log(`  ${c.id}: ${n} parcels`);
}
