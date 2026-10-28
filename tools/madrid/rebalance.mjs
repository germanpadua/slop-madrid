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
console.log(`rebalance: ${deduped} duplicate copies removed, ${moved} parcels moved to their centre's owner`);
for (const c of carriers) {
  const n = c.kind === 'seed' ? c.groups.reduce((x, g) => x + g.length, 0) : c.tile.parcels.length;
  console.log(`  ${c.id}: ${n} parcels`);
}
