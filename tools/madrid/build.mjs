// tools/madrid/build.mjs — writes js/madrid-geodata.js: real Madrid geography in the simulation's
// 1:1 world frame, from OpenStreetMap + Ayuntamiento IDEAM + Catastro (see MADRID.md).
// Frame: 1 unit = 1 m, x = east, z = south (north = -z), no rotation (bearingDeg 0),
// origin at Puerta del Sol. Projection: lon/lat -> UTM 30N (ETRS89), then translated.
//
// Inputs (tools/data/madrid/, see fetch.sh):
//   osm_madrid.json             Overpass (buildings, highways, water, parks, squares) — ODbL
//   alturas.json                Ayuntamiento EDIFICIOS_ALTURAS (footprint + ALTURA m) — © IDEAM
//   catastro_buildings_raw.json Catastro INSPIRE Building GML members (backup footprints) — © IGN/Catastro
//
// usage: node --max-old-space-size=4096 tools/madrid/build.mjs [out.js]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Raster, rdp, rdpRing, ringArea, bbox, r1, pointInRing } from '../geo-geometry.mjs';
const log = (...args) => console.log('[madrid]', ...args);
import { getPhase } from './config.mjs';
import { toWorld, utmToWorld } from './projection.mjs';

const DATA = process.env.MADRID_DATA || fileURLToPath(new URL('../../tools/data/madrid/', import.meta.url));
const SOURCES = [
  'OpenStreetMap (© OpenStreetMap contributors, ODbL; Overpass or local PBF)',
  'Ayuntamiento de Madrid IDEAM EDIFICIOS_ALTURAS (© Ayuntamiento de Madrid)',
];
const OUT = process.argv[2] || fileURLToPath(new URL('../../js/madrid-geodata.js', import.meta.url));
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const phase = getPhase();
log(`phase ${phase.name} (${phase.label})`);

// =====================================================================================================================
// 1. FRAME — UTM 30N (EPSG:25830) translation, no rotation (tools/madrid/projection.mjs).
// =====================================================================================================================
// phase bbox in world coordinates (from the UTM corners)
const [bx0, by0, bx1, by1] = phase.utm;
const [wx0, wz1] = utmToWorld(bx0, by0);
const [wx1, wz0] = utmToWorld(bx1, by1);
log(`world bbox x [${wx0.toFixed(0)}, ${wx1.toFixed(0)}] z [${wz0.toFixed(0)}, ${wz1.toFixed(0)}] (${((wx1 - wx0) / 1000).toFixed(2)} x ${((wz1 - wz0) / 1000).toFixed(2)} km)`);

// The build frame is the *fetch* box (core + 100 m overlap): blocks that touch it are cut, so they are dropped, and
// every feature is owned by exactly one tile, decided by its centroid falling in the tile core. For the phase-2 seed
// the core is the phase-2 box, so this only removes the boundary leftovers of the padded fetch.
const CORE = (phase.core ? phase.core.map((r) => r.slice()) : [[wx0, wz0, wx1, wz1]])
  .map(([x0, z0, x1, z1]) => {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    return [x0, z0, x1, z1];
  });
const IS_TILE = !!phase.tile;
// Phase-3 modules are conquered ground. Pin their footprint ownership while filling new neighbours. The old
// block/orphan rule was context-dependent: the same parcel could be a block member here and an orphan next door.
// New cells use centroid ownership (whole rings, never clipped); a parcel already delivered by the seed/phase3
// stays with that owner. This reads only the fixed phase3 set, so build order never changes the result.
const legacyParcels = new Set();
let modernParcelTile = false;
if (IS_TILE) {
  const mf = JSON.parse(fs.readFileSync(new URL('./tiles.json', import.meta.url), 'utf8'));
  const legacyIds = new Set([mf.grid.seed, ...mf.phases['3']]);
  modernParcelTile = !legacyIds.has(phase.tile.id);
  if (!legacyIds.has(phase.tile.id)) {
    const { PARCELS } = await import(new URL('../../js/madrid-geodata-blocks.js', import.meta.url));
    for (const p of PARCELS.flat()) legacyParcels.add(p.ring.join(','));
    for (const t of mf.tiles.filter((t) => legacyIds.has(t.id) && t.id !== mf.grid.seed)) {
      const { TILE } = await import(new URL(`../../${t.module}`, import.meta.url));
      for (const p of TILE.parcels) legacyParcels.add(p.ring.join(','));
    }
  }
}
const ALL_CORES = phase.allCores || CORE;
const inCore = (x, z) => CORE.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
// A point in the fetch overlap belongs to no core: a feature there is owned by whoever owns its block. A point inside
// another tile's core belongs to that tile, so this tile must not emit it (no doubled building at a seam).
const inOtherCore = (x, z) => !inCore(x, z)
  && ALL_CORES.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
log(`core: ${CORE.map((r) => `[${r.map((v) => v.toFixed(0)).join(',')}]`).join(' + ')} (${IS_TILE ? `tile ${phase.tile.id}` : 'seed'})`);

const flat = (pts) => pts.flatMap(([x, z]) => [r1(x), r1(z)]);

// Connected components of a binary raster -> outer rings (x,z; negative shoelace), largest first. Used for the block
// slabs (morphological merge of the cadastral parcels) and for the land (the phase box minus the real water).
function componentRings(ras, minCells, simplify, minArea) {
  const { w, h, d } = ras;
  const label = new Int32Array(w * h);
  const compCells = [];
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (!d[s] || label[s]) continue;
    const k = compCells.length;
    const cells = [];
    stack.push(s);
    label[s] = k + 1;
    while (stack.length) {
      const c = stack.pop();
      cells.push(c);
      const i = c % w, j = (c / w) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const n = nj * w + ni;
        if (d[n] && !label[n]) { label[n] = k + 1; stack.push(n); }
      }
    }
    compCells.push(cells);
  }
  const out = [];
  for (const cells of compCells) {
    if (cells.length < minCells) continue;
    let i0 = w, j0 = h, i1 = 0, j1 = 0;
    for (const c of cells) { const i = c % w, j = (c / w) | 0; if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
    const sub = new Raster(ras.x0 + i0 * ras.res, ras.z0 + j0 * ras.res, ras.x0 + (i1 + 1) * ras.res, ras.z0 + (j1 + 1) * ras.res, ras.res);
    for (const c of cells) sub.d[(((c / w) | 0) - j0) * sub.w + ((c % w) - i0)] = 1;
    const ring = sub.traceOuter();
    const area = Math.abs(ringArea(ring));
    if (area < minArea) continue;
    if (ringArea(ring) > 0) ring.reverse();
    out.push({ ring: rdpRing(ring, simplify), area, cells, w, i0, j0, i1, j1 });
  }
  return out.sort((a, b) => b.area - a.area);
}

// Rect cover of a block's built cells (greedy maximal rectangles, row-major) at a coarse resolution: the building
// massing works inside each rect (rows of lots, courtyards, towers) and clamps each part to the IDEAM parcel height, so
// one rect per 12 m of block keeps the real footprint while letting the lotting do the detail work.
function cellRects(comp, res, ox, oz, keep, factor = 6) {
  const { cells, w, i0, j0, i1, j1 } = comp;
  const cw = i1 - i0 + 1, ch = j1 - j0 + 1;
  const cw2 = Math.ceil(cw / factor), ch2 = Math.ceil(ch / factor);
  const sum = new Uint16Array(cw2 * ch2);
  for (const c of cells) {
    if (keep && !keep.d[c]) continue;
    const gi = (c % w) - i0, gj = ((c / w) | 0) - j0;
    sum[((gj / factor) | 0) * cw2 + ((gi / factor) | 0)]++;
  }
  const half = (factor * factor) / 2;
  const mask = new Uint8Array(cw2 * ch2);
  for (let k = 0; k < mask.length; k++) mask[k] = sum[k] >= half ? 1 : 0;
  const used = new Uint8Array(cw2 * ch2);
  const step = res * factor;
  const rects = [];
  for (let j = 0; j < ch2; j++) {
    for (let i = 0; i < cw2; i++) {
      if (!mask[j * cw2 + i] || used[j * cw2 + i]) continue;
      let i2 = i;
      while (i2 + 1 < cw2 && mask[j * cw2 + i2 + 1] && !used[j * cw2 + i2 + 1]) i2++;
      let j2 = j;
      for (let grow = true; grow && j2 + 1 < ch2;) {
        grow = true;
        for (let k = i; k <= i2; k++) {
          if (!mask[(j2 + 1) * cw2 + k] || used[(j2 + 1) * cw2 + k]) { grow = false; break; }
        }
        if (grow) j2++;
      }
      for (let jj = j; jj <= j2; jj++) for (let k = i; k <= i2; k++) used[jj * cw2 + k] = 1;
      rects.push([r1(ox + (i0 + i * factor) * res), r1(ox + (i0 + (i2 + 1) * factor) * res),
        r1(oz + (j0 + j * factor) * res), r1(oz + (j0 + (j2 + 1) * factor) * res)]);
    }
  }
  return rects.filter((r) => r[1] - r[0] >= 8 && r[3] - r[2] >= 8);
}

// =====================================================================================================================
// 2. OSM — roads, parks & water, squares, named landmark footprints
// =====================================================================================================================
const osm = load('osm_madrid.json');
const els = osm.elements || [];
// Sourced positions, deliberately not random scatter. Dimensions without tags are documented stylised low-poly.
const streetPoints = els.filter((e) => e.type === 'node' &&
  (e.tags?.natural === 'tree' || e.tags?.highway === 'street_lamp' || e.tags?.highway === 'traffic_signals'))
  .map((e) => {
    const [x, z] = toWorld(e.lon, e.lat);
    const kind = e.tags.natural === 'tree' ? 'tree' : e.tags.highway;
    const h = parseFloat(e.tags.height);
    return { id: `n${e.id}`, kind, x: r1(x), z: r1(z), h: Number.isFinite(h) && h > 0 ? r1(h) : null };
  }).filter((p) => inCore(p.x, p.z));

// Highway class -> curb-to-curb width (m) when OSM has no explicit width/lanes
const HIGHWAY_W = { motorway: 24, trunk: 22, primary: 16, secondary: 14, tertiary: 11, residential: 9, unclassified: 8, living_street: 7, pedestrian: 8, service: 5.5, road: 9, motorway_link: 12, trunk_link: 10, primary_link: 8, secondary_link: 7, tertiary_link: 6 };
const VEHICULAR = new Set(Object.keys(HIGHWAY_W));
const roadW = (t) => {
  if (t.width) { const v = parseFloat(String(t.width).replace(',', '.')); if (Number.isFinite(v)) return v; }
  if (t.lanes) { const n = parseInt(t.lanes, 10); if (Number.isFinite(n) && n > 0) return n * 3.4 + 2; }
  return HIGHWAY_W[t.highway] || 8;
};

const roadLines = [];
for (const e of els) {
  if (e.type !== 'way' || !e.geometry) continue;
  const t = e.tags || {};
  if (!VEHICULAR.has(t.highway)) continue;
  const pts = e.geometry.filter((p) => p).map((p) => toWorld(p.lon, p.lat));
  const kept = pts.filter(([x, z]) => x >= wx0 - 20 && x <= wx1 + 20 && z >= wz0 - 20 && z <= wz1 + 20);
  if (kept.length < 2) continue;
  const dir = t.oneway === 'yes' ? 1 : t.oneway === '-1' ? -1 : 0;
  roadLines.push({ name: t.name || '', w: roadW(t), dir, lanes: parseInt(t.lanes || '0', 10) || 0, hw: /^(motorway|trunk)/.test(t.highway) ? 1 : 0, pts: rdp(kept, 0.6) });
}
// Same ownership rule for roads (they carry the bridge decks over the water): keep the ones that enter the core.
roadLines.splice(0, roadLines.length, ...roadLines.filter((r) => r.pts.some(([x, z]) => inCore(x, z))));
log(`${roadLines.length} road polylines, ${roadLines.filter((r) => r.name).length} named`);

// parks, water & pedestrian squares (ground colouring + GEO.parks)
// Water *areas* only: `waterway=river|stream` is the centreline of a channel, not a polygon, and treating such a
// closed way as an area carves a 15 ha hole out of the city (seen on OSM way 1340243106).
const WATER_AREA = new Set(['river', 'riverbank', 'canal', 'stream', 'brook', 'ditch', 'drain']); // waterway values that can be areas
const areaKind = (t) => {
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park';
  if (t.natural === 'water') return 'water';
  if (t.water && t.water !== 'no') return 'water'; // water=river|pond|basin|canal|reservoir
  if (t.waterway && (t.waterway === 'riverbank' || (t.area === 'yes' && WATER_AREA.has(t.waterway)))) return 'water';
  if (t.landuse === 'grass' || t.landuse === 'meadow' || t.landuse === 'forest') return 'grass';
  if (t.place === 'square') return 'plaza';
  if (t.highway === 'pedestrian' && (t.area === 'yes' || t.area === 'true')) return 'plaza';
  return null;
};
const parks = [];
const water = [];
const plazas = [];
for (const e of els) {
  if (e.type !== 'way' || !e.geometry) continue;
  const kind = areaKind(e.tags || {});
  if (!kind) continue;
  const pts = e.geometry.filter((p) => p).map((p) => toWorld(p.lon, p.lat));
  if (pts.length < 3) continue;
  const ring = rdpRing(pts, 0.8);
  if (Math.abs(ringArea(ring)) < 40) continue;
  if (ringArea(ring) > 0) ring.reverse(); // negative shoelace in x,z
  if (kind === 'water') water.push(ring);
  else if (kind === 'plaza') plazas.push({ name: (e.tags || {}).name || '', ring });
  else parks.push({ name: (e.tags || {}).name || '', cat: kind, acres: Math.abs(ringArea(ring)) / 4046.86, rings: [ring] });
}

// Multipolygons: the Manzanares and most of the big parks are relations, not ways. Stitch each relation's outer
// member ways into closed rings (members can be split at bridges/street crossings) and keep the real polygons.
const near = (a, b) => Math.abs(a.lon - b.lon) < 1e-7 && Math.abs(a.lat - b.lat) < 1e-7;
function stitchOuterRings(members) {
  const segs = members.filter((m) => m.role !== 'inner' && Array.isArray(m.geometry)).map((m) => m.geometry.filter((p) => p));
  const rings = [];
  while (segs.length) {
    let cur = segs.pop();
    if (cur.length < 2) continue;
    for (let progressed = true; progressed;) {
      progressed = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (!s.length) { segs.splice(i, 1); i--; continue; }
        const head = cur[0], tail = cur[cur.length - 1];
        let next = null;
        if (near(tail, s[0])) next = cur.concat(s.slice(1));
        else if (near(tail, s[s.length - 1])) next = cur.concat(s.slice(0, -1).reverse());
        else if (near(head, s[s.length - 1])) next = s.slice(0, -1).concat(cur);
        else if (near(head, s[0])) next = s.slice(1).reverse().concat(cur);
        if (next) { cur = next; segs.splice(i, 1); progressed = true; break; }
      }
      if (cur.length > 20000) break; // runaway stitch: give up on this relation
    }
    if (cur.length >= 4 && near(cur[0], cur[cur.length - 1])) rings.push(cur);
  }
  return rings;
}
let waterRelations = 0;
for (const e of els) {
  if (e.type !== 'relation' || !e.members) continue;
  const kind = areaKind(e.tags || {});
  if (!kind || kind === 'plaza') continue;
  for (const raw of stitchOuterRings(e.members)) {
    const pts = raw.map((p) => toWorld(p.lon, p.lat));
    const ring = rdpRing(pts, 0.8);
    if (Math.abs(ringArea(ring)) < 100) continue;
    if (ringArea(ring) > 0) ring.reverse();
    if (kind === 'water') { water.push(ring); waterRelations++; }
    else {
      const name = (e.tags || {}).name || '';
      const prev = parks.find((p) => p.name === name && p.cat === kind);
      if (prev) { prev.rings.push(ring); prev.acres += Math.abs(ringArea(ring)) / 4046.86; }
      else parks.push({ name, cat: kind, acres: Math.abs(ringArea(ring)) / 4046.86, rings: [ring] });
    }
  }
}
log(`${parks.length} parks, ${water.length} water bodies (${waterRelations} from area relations), ${plazas.length} plazas/squares`);

// =====================================================================================================================
// 3. Real buildings — Ayuntamiento EDIFICIOS_ALTURAS: authoritative footprint + real height (m).
//    Parcels merge into block slabs by raster morphology (same idea as tools/geo-blocks.mjs).
// =====================================================================================================================
const alturas = load('alturas.json');
const parcels = [];
for (const f of alturas.features) {
  const h = f.attributes?.ALTURA;
  const g = f.geometry?.rings?.[0];
  if (!Number.isFinite(h) || !g || g.length < 4) continue;
  const rings = f.geometry.rings.map((r) => rdpRing(r.map(([x, y]) => utmToWorld(x, y)), 0.4));
  const outerSign = Math.sign(ringArea(rings[0]));
  // ESRI polygons: exterior rings share winding; interiors have the opposite winding. Preserve disjoint wings
  // and attach each courtyard to its containing exterior. Legacy generation keeps its original contract.
  const exteriors = modernParcelTile ? rings.filter((r) => Math.sign(ringArea(r)) === outerSign) : [rings[0]];
  for (const ring of exteriors) {
  if (Math.abs(ringArea(ring)) < 12) continue; // kiosks & sheds
  const bb = bbox(ring);
  if (bb.x1 - bb.x0 < 1.2 || bb.z1 - bb.z0 < 1.2) continue;
  if (ringArea(ring) > 0) ring.reverse();
  // The WFS returns every footprint that intersects the box: keep the ones whose centre is inside the fetch box. A
  // footprint carries no ownership of its own — it is emitted with the block that owns it (blocks are owned by the
  // tile whose core holds the block centre), so a parcel in the fetch overlap is written by exactly one tile.
  let cx = 0, cz = 0;
  for (const q of ring) { cx += q[0]; cz += q[1]; }
  cx /= ring.length; cz /= ring.length;
  if (cx < wx0 || cx > wx1 || cz < wz0 || cz > wz1) continue;
  const holes = modernParcelTile ? rings.filter((r) => !exteriors.includes(r) && r.length >= 3 && Math.abs(ringArea(r)) > 1 &&
    pointInRing(r[0][0], r[0][1], ring)) : [];
  parcels.push({ ring, holes, h: Math.max(2.4, Math.round(h * 10) / 10), cx, cz });
  }
}
log(`${parcels.length} real building parcels (IDEAM alturas)`);

// label connected components of the parcel raster, then trace each component's outer ring
const RES = 2;
// The raster origin is snapped to a global 100 m grid (not to this tile's frame): the same block then traces to the
// same ring in every tile that carries it, so ownership decisions agree across tiles.
const RX0 = Math.floor((wx0 - 4) / 100) * 100, RZ0 = Math.floor((wz0 - 4) / 100) * 100;
const RX1 = Math.ceil((wx1 + 4) / 100) * 100, RZ1 = Math.ceil((wz1 + 4) / 100) * 100;
const ras = new Raster(RX0, RZ0, RX1, RZ1, RES);
for (const p of parcels) ras.fillRing(p.ring, 1);
// Same grid as the slab raster, filled only with the parcels as built (before any morphology)
const lotRas = new Raster(ras.x0, ras.z0, ras.x0 + (ras.w - 1) * RES, ras.z0 + (ras.h - 1) * RES, RES);
for (const p of parcels) lotRas.fillRing(p.ring, 1);
ras.close(4); // patios < 8 m across and gaps to the neighbour merge into the slab
ras.open(9);  // drop slivers
// Blocks that touch the fetch frame are cut slabs: drop them (the neighbouring tile carries the whole one).
const insideFrame = (ring) => ring.every(([x, z]) => x > wx0 + 0.5 && x < wx1 - 0.5 && z > wz0 + 0.5 && z < wz1 - 0.5);
// A complete block belongs to the tile whose core holds the larger part of it (clipped-area fraction > 1/2). Cores are
// disjoint and the rings are identical across tiles, so the rule has one owner: no doubled slab, no lost block. A
// block straddling a seam is still drawn whole, by its owner.
const coreFraction = (ring) => {
  const area = Math.abs(ringArea(ring));
  if (!area) return 0;
  let inside = 0;
  for (const [x0, z0, x1, z1] of CORE) {
    const c = clipWater(ring, x0, z0, x1, z1);
    if (c) inside += Math.abs(ringArea(c));
  }
  return inside / area;
};
const allBlockComps = componentRings(ras, 60, 0.8, 250); // < ~240 m² of footprint is not a block
// Every block that the fetch box carries whole is a candidate for every tile that sees it: the ownership flag decides
// which tile writes it, but parcel→block attachment uses the whole candidate set (so the same parcel lands on the same
// block — and therefore on the same owner — in every tile).
const frameBlocks = allBlockComps.filter((c) => insideFrame(c.ring));
for (const c of frameBlocks) c.owned = coreFraction(c.ring) > 0.5;
const ownedBlocks = frameBlocks.filter((c) => c.owned);
log(`block slabs: ${allBlockComps.length} traced, ${frameBlocks.length} whole inside the fetch box, ${ownedBlocks.length} owned by this core`);
// Lot rects per block: the coverage of the real cadastral parcels (so courtyards and irregular fronts stay open). The
// massing works inside each rect (rows of lots, courtyards, towers) and clamps every part to the IDEAM parcel height.
for (const c of frameBlocks) c.rects = cellRects(c, RES, ras.x0, ras.z0, lotRas);
log(`merged into ${ownedBlocks.length} owned blocks, ${ownedBlocks.reduce((t, c) => t + c.rects.length, 0)} lot rects`);
// Assign every parcel to the smallest candidate block whose bounds contain its centroid (parcels share the raster the
// slabs were traced from, so this is a containment test). Parcels are bucketed once by centroid: O(parcels + blocks).
const ownerId = new Map(); // frame-block index -> index in `blocks` (owned only)
let nextBlockId = 0;
for (const c of frameBlocks) if (c.owned) ownerId.set(frameBlocks.indexOf(c), nextBlockId++);
const blocks = ownedBlocks.map((c, id) => ({ id, ring: c.ring, rects: c.rects, parcels: [] }));
const blockBoxes = frameBlocks.map((c) => bbox(c.ring));
const blockAreas = frameBlocks.map((c) => Math.abs(ringArea(c.ring)));
// Even-odd point-in-ring: a parcel belongs to the block whose area actually contains its centre (bboxes of two
// neighbouring blocks overlap at their gap, so bbox containment alone would put one parcel on both).
// The traced slab ring is simplified (~0.8 m), so a parcel that really sits on the block can fall a metre or two
// outside it: the test accepts anything within SEAM_TOL of the outline, while streets (6 m and wider) stay excluded.
const SEAM_TOL = 2.5;
const ringDistance = (ring, x, z) => {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j], [bx, bz] = ring[i];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    best = Math.min(best, Math.hypot(ax + t * dx - x, az + t * dz - z));
  }
  return best;
};
const inRing = (ring, x, z) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit || ringDistance(ring, x, z) <= SEAM_TOL;
};
const CELL = 64;
const blockCells = new Map();
blockBoxes.forEach((bb, id) => {
  for (let ix = Math.floor(bb.x0 / CELL); ix <= Math.floor(bb.x1 / CELL); ix++) {
    for (let iz = Math.floor(bb.z0 / CELL); iz <= Math.floor(bb.z1 / CELL); iz++) {
      const k = ix * 100000 + iz;
      if (!blockCells.has(k)) blockCells.set(k, []);
      blockCells.get(k).push(id);
    }
  }
});
let orphans = 0, orphanArea = 0;
const parcelOrphans = [];
for (const p of parcels) {
  const list = blockCells.get(Math.floor(p.cx / CELL) * 100000 + Math.floor(p.cz / CELL));
  if (!list) { orphans++; parcelOrphans.push(p); continue; }
  let best = -1, bestArea = Infinity;
  for (const id of list) {
    const bb = blockBoxes[id];
    if (p.cx <= bb.x0 || p.cx >= bb.x1 || p.cz <= bb.z0 || p.cz >= bb.z1) continue;
    if (!inRing(frameBlocks[id].ring, p.cx, p.cz)) continue;
    if (blockAreas[id] < bestArea) { bestArea = blockAreas[id]; best = id; }
  }
  if (best < 0) { orphans++; orphanArea += Math.abs(ringArea(p.ring)); parcelOrphans.push(p); continue; }
  p.frameBlock = best;
  // A footprint belongs to the block that contains its centre: that block's owner writes it (seam buildings included,
  // which keeps a block whole). Footprints in no block are owned by the tile whose core holds their centre.
  p.owned = ownerId.has(best);
  if (p.owned) blocks[ownerId.get(best)].parcels.push(p);
}
const orphansInCore = parcelOrphans.filter((p) => inCore(p.cx, p.cz)).length;
log(`${blocks.length} blocks kept, ${blocks.reduce((t, b) => t + b.parcels.length, 0)} parcels attached (${orphans} orphan, ${orphansInCore} of them centred in this core, ${(orphanArea / 1e4).toFixed(0)} ha of isolated footprints)`);

// =====================================================================================================================
// 4. Landmarks — named OSM footprints with tagged height where available, for the generic
//    extruder, the map and teleports. i3s realistic meshes layer on top (see MADRID.md).
// =====================================================================================================================
const LANDMARK_NAMES = new Set([
  'Real Casa de Correos', 'Palacio de Comunicaciones', 'Palacio de Cibeles', 'Banco de España', 'Palacio de Linares',
  'Palacio del Congreso de los Diputados', 'Fuente de Cibeles', 'Plaza de Cibeles', 'Puerta de Alcalá', 'Plaza de la Independencia', 'Real Academia Española', 'Palacio de Santoña',
  'Teatro Real', 'Plaza de Isabel II', 'Edificio España', 'Plaza de Callao', 'Círculo de Bellas Artes',
  'Hotel Palace', 'Palacio Hotel', 'Plaza Mayor', 'Casa de la Panadería', 'Plaza de la Villa', 'Casa y Torre de los Lujanes',
  'Mercado de San Miguel', 'Iglesia de San Ginés', 'Oratorio del Caballero de Gracia', 'Edificio Grassy',
  'Palacio de la Prensa', 'Edificio Carrión', 'Teatro Capitol', 'Edificio Telefónica', 'Teatro Español',
  'Congreso de los Diputados', 'Plaza de Santa Ana', 'Puerta del Sol', 'Plaza de Canalejas', 'Iglesia de San José',
  // Phase 2 (almendra central oeste): the hits named for this phase, plus their real neighbours
  'Templo de Debod', 'Palacio Real', 'Palacio Real de Madrid', 'Catedral de la Almudena', 'Príncipe Pío',
  'Catedral de Santa María la Real de la Almudena', 'Plaza de España', 'Plaza de Oriente', 'Campo del Moro',
  'Museo Nacional Centro de Arte Reina Sofía', 'Museo Reina Sofía', 'Estación de Atocha', 'Madrid Puerta de Atocha',
  'Estación de Atocha-Almudena Grandes', 'Estación de Príncipe Pío', 'Madrid-Príncipe Pío', 'Estación del Norte',
  'Basílica de San Francisco el Grande', 'Palacio de Uceda', 'Mercado de San Antón', 'Iglesia de San Andrés',
  'Palacio de la Duquesa de Sueca', 'Real Basílica de San Francisco el Grande', 'Torre de Madrid', 'Edificio Madrid-París',
]);
const landmarks = {};
// POI nodes (fountains, statues, clocks, memorials): points, extruder can skip but map/teleport use them
for (const e of els) {
  if (e.type !== 'node') continue;
  const t = e.tags || {};
  const name = t.name || t['name:es'] || '';
  if (!name) continue;
  const isPOI = t.historic === 'monument' || t.historic === 'memorial' || t.amenity === 'fountain' || t.amenity === 'clock' ||
    t.tourism === 'artwork' || t.tourism === 'attraction' || t.man_made === 'obelisk' || t.man_made === 'tower' ||
    t.man_made === 'cross' || t.railway === 'station';
  if (!isPOI) continue;
  const [x, z] = toWorld(e.lon, e.lat);
  if (x < wx0 || x > wx1 || z < wz0 || z > wz1) continue;
  landmarks[name] = { pt: [r1(x), r1(z)], ring: [], cx: r1(x), cz: r1(z), w: 0, d: 0 };
}
// Multipolygon relations (Banco de España, Palacio del Congreso, Palacio de Linares, Puerta del Sol square...)
for (const e of els) {
  if (e.type !== 'relation' || !e.members) continue;
  const t = e.tags || {};
  const name = t.name || t['name:es'] || '';
  if (!name || !(t.building || t.historic || t.tourism || t.amenity || t.place === 'square')) continue;
  if (!name || !LANDMARK_NAMES.has(name)) continue;
  const rings = [];
  for (const m of e.members) {
    if (m.role === 'inner' || !m.geometry) continue;
    const pts = m.geometry.filter((p) => p).map((p) => toWorld(p.lon, p.lat));
    if (pts.length < 3 || Math.abs(ringArea(pts)) < 60) continue;
    if (ringArea(pts) > 0) pts.reverse();
    rings.push(rdpRing(pts, 0.6));
  }
  if (!rings.length) continue;
  const big = rings.reduce((a, r) => (Math.abs(ringArea(r)) > Math.abs(ringArea(a)) ? r : a));
  const bb = bbox(big);
  const h = parseFloat(t.height || '') || (parseInt(t['building:levels'] || '0', 10) ? parseInt(t['building:levels'], 10) * 3.6 : 0);
  landmarks[name] = { ring: flat(big), cx: r1((bb.x0 + bb.x1) / 2), cz: r1((bb.z0 + bb.z1) / 2), w: r1(bb.x1 - bb.x0), d: r1(bb.z1 - bb.z0), h: h ? Math.round(h * 10) / 10 : undefined, hSrc: h ? 'OSM' : undefined, building: t.building ? 1 : 0 };
}
// The big squares we name teleports after (OSM splits them across many open/fragmented ways):
// merge every fragment of the same name into one footprint (union bbox + outer hull ring)
const PLAZA_NAMES = ['Plaza de la Cibeles', 'Plaza de Callao', 'Plaza de la Puerta del Sol', 'Plaza Mayor', 'Plaza de la Villa',
  'Plaza de la Independencia', 'Plaza de España', 'Plaza de Oriente', 'Plaza de la Armería', 'Glorieta del Emperador Carlos V'];
const plazaFragments = new Map();
for (const e of els) {
  if (e.type !== 'way' || !e.geometry) continue;
  const t = e.tags || {};
  const name = t.name || t['name:es'] || '';
  if (!name || !PLAZA_NAMES.includes(name)) continue;
  const pts = e.geometry.filter((p) => p).map((p) => toWorld(p.lon, p.lat));
  if (pts.length < 3) continue;
  if (!plazaFragments.has(name)) plazaFragments.set(name, []);
  plazaFragments.get(name).push(pts);
}
for (const [name, frags] of plazaFragments) {
  if (landmarks[name]) continue;
  const bb = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const f of frags) for (const [x, z] of f) { bb.x0 = Math.min(bb.x0, x); bb.x1 = Math.max(bb.x1, x); bb.z0 = Math.min(bb.z0, z); bb.z1 = Math.max(bb.z1, z); }
  const area = (bb.x1 - bb.x0) * (bb.z1 - bb.z0);
  if (area < 400) continue;
  landmarks[name] = { ring: flat([[bb.x0, bb.z0], [bb.x1, bb.z0], [bb.x1, bb.z1], [bb.x0, bb.z1]]), cx: r1((bb.x0 + bb.x1) / 2), cz: r1((bb.z0 + bb.z1) / 2), w: r1(bb.x1 - bb.x0), d: r1(bb.z1 - bb.z0) };
}
// Named building footprints (ways): Teatro Real, Palacio de Cibeles, Casa de la Panadería, Círculo de Bellas Artes...
for (const e of els) {
  if (e.type !== 'way' || !e.geometry) continue;
  const t = e.tags || {};
  const name = t.name || t['name:es'] || '';
  if (!name || !LANDMARK_NAMES.has(name)) continue;
  const isArea = t.building || t.place === 'square' || t.historic || t.tourism || t.amenity || t.man_made; // closed way = area
  if (!isArea) continue;
  const pts = e.geometry.filter((p) => p).map((p) => toWorld(p.lon, p.lat));
  if (pts.length < 3) continue;
  const ring = rdpRing(pts, 0.6);
  if (Math.abs(ringArea(ring)) < 30) continue;
  if (ringArea(ring) > 0) ring.reverse();
  const bb = bbox(ring);
  const h = parseFloat(t.height || '') || (parseInt(t['building:levels'] || '0', 10) ? parseInt(t['building:levels'], 10) * 3.6 : 0);
  landmarks[name] = { ring: flat(ring), cx: r1((bb.x0 + bb.x1) / 2), cz: r1((bb.z0 + bb.z1) / 2), w: r1(bb.x1 - bb.x0), d: r1(bb.z1 - bb.z0), h: h ? Math.round(h * 10) / 10 : undefined, hSrc: h ? 'OSM' : undefined, building: t.building ? 1 : 0 };
}

// Canonical keys for features whose OSM name varies (accents, station renames, "de Madrid" suffixes). Only applied to
// buildings/stations/squares, and only when the OSM name really is that feature.
const CANON = [
  ['Templo de Debod', /templo de debod/i],
  ['Palacio Real', /^palacio real( de madrid)?$/i],
  ['Catedral de la Almudena', /almudena/i],
  ['Plaza de España', /^plaza de espa(n|ñ)a$/i],
  ['Museo Reina Sofía', /reina sof(i|í)a/i],
  ['Estación de Atocha', /puerta de atocha|estaci(o|ó)n de atocha/i],
  ['Estación de Príncipe Pío', /pr(i|í)ncipe p(i|í)o/i],
];
for (const [canonical, re] of CANON) {
  if (landmarks[canonical]) continue;
  let bestName = null, bestArea = -1;
  for (const [name, lm] of Object.entries(landmarks)) {
    if (!re.test(name) || !(lm.w > 8 && lm.d > 8)) continue; // a real footprint, not a POI pin
    const area = lm.w * lm.d;
    if (area > bestArea) { bestArea = area; bestName = name; }
  }
  if (bestName) {
    landmarks[canonical] = { ...landmarks[bestName], osmName: bestName };
    log(`  landmark ${canonical} <- OSM "${bestName}"`);
  }
}

// Real landmark heights: the IDEAM parcel under the footprint (authoritative), never a guess. The OSM height tag is
// only used where the cadastral layer has no parcel for the building.
{
  const CELL = 64;
  const grid = new Map();
  for (const p of parcels) {
    p.bb = bbox(p.ring);
    for (let ix = Math.floor(p.bb.x0 / CELL); ix <= Math.floor(p.bb.x1 / CELL); ix++) {
      for (let iz = Math.floor(p.bb.z0 / CELL); iz <= Math.floor(p.bb.z1 / CELL); iz++) {
        const k = ix * 100000 + iz;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(p);
      }
    }
  }
  const inRing = (ring, x, z) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  };
  const heightAt = (x, z) => {
    let h = 0;
    for (const p of grid.get(Math.floor(x / CELL) * 100000 + Math.floor(z / CELL)) || []) {
      if (x < p.bb.x0 || x > p.bb.x1 || z < p.bb.z0 || z > p.bb.z1) continue;
      if (p.h > h && inRing(p.ring, x, z)) h = p.h;
    }
    return h;
  };
  let measured = 0;
  for (const lm of Object.values(landmarks)) {
    if (!lm.building || !lm.ring || lm.ring.length < 6) continue;
    let h = 0;
    const N = 6;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x = lm.cx - lm.w / 2 + (lm.w * (i + 0.5)) / N;
        const z = lm.cz - lm.d / 2 + (lm.d * (j + 0.5)) / N;
        const ph = heightAt(x, z);
        if (ph > h) h = ph;
      }
    }
    if (h > 0) { lm.h = h; lm.hSrc = 'IDEAM'; measured++; }
  }
  log(`landmark heights: ${measured} measured from IDEAM parcels`);
}
// Tile ownership: a landmark belongs to the tile whose core holds its centre, so the fetch overlap never produces it
// twice. The seed's core is the phase-2 box, so its landmark set is unchanged.
for (const [name, lm] of Object.entries(landmarks)) if (!inCore(lm.cx, lm.cz)) delete landmarks[name];
log(`${Object.keys(landmarks).length} landmark footprints owned by this core: ${Object.keys(landmarks).join(', ') || '(none)'}`);

// =====================================================================================================================
// 5. Corridors for the traffic system — avenues (N-S streets: x ~= const) & major streets (E-W / diagonal:
//    z ~= const), straight from OSM geometry, plus the road graph with links split at shared nodes so every
//    real intersection is a graph junction.
// =====================================================================================================================
const slug = (n) => n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `v_${n}`;
const byName = new Map(); // merge the OSM ways that share a street name
for (const r of roadLines) {
  if (!r.name || r.pts.length < 2) continue;
  if (!byName.has(r.name)) byName.set(r.name, []);
  byName.get(r.name).push(r);
}
const avenues = [];
const streetRuns = [];
for (const [name, rs] of byName) {
  const extX = Math.max(...rs.flatMap((r) => r.pts).map((p) => p[0])) - Math.min(...rs.flatMap((r) => r.pts).map((p) => p[0]));
  const extZ = Math.max(...rs.flatMap((r) => r.pts).map((p) => p[1])) - Math.min(...rs.flatMap((r) => r.pts).map((p) => p[1]));
  let x = 0, z = 0, wsum = 0;
  for (const r of rs) {
    const [ax, az] = r.pts[0], [bx, bz] = r.pts[r.pts.length - 1];
    x += ((ax + bx) / 2) * r.w; z += ((az + bz) / 2) * r.w; wsum += r.w;
  }
  x /= wsum; z /= wsum;
  const NS = extZ > extX;
  const w = rs.reduce((m, r) => Math.max(m, r.w), 0);
  const lanes = rs.reduce((m, r) => Math.max(m, r.lanes), 0);
  const dir = rs[0].dir;
  const hw = rs.some((r) => r.hw);
  if (NS) {
    const segs = rs.map((r) => {
      const zs = r.pts.map((p) => p[1]);
      return { z0: r1(Math.min(...zs)), z1: r1(Math.max(...zs)), dir: r.dir, w: r1(r.w), lanes: r.lanes, names: [[r1(Math.min(...zs)), r1(Math.max(...zs)), name]] };
    });
    avenues.push({ id: slug(name), label: name, x: r1(x), width: r1(w), lanes, dir, hw, segs });
  } else {
    // one entry per contiguous way so a long street still gets sane z runs & x extents
    for (const r of rs) {
      const xs = r.pts.map((p) => p[0]);
      const zs = r.pts.map((p) => p[1]);
      if (Math.max(...xs) - Math.min(...xs) < 90) continue; // short E-W scraps stay paint-only
      streetRuns.push({ n: 0, label: name, z: r1(zs.reduce((s, v) => s + v, 0) / zs.length), w: r1(r.w), lanes: r.lanes, dir: r.dir, hw: r.hw,
        segs: [[r1(Math.min(...xs)), r1(Math.max(...xs)), r.dir, r1(r.w)]] });
    }
  }
}
avenues.sort((a, b) => a.x - b.x);
streetRuns.sort((a, b) => a.z - b.z);
streetRuns.forEach((s, i) => { s.n = i + 1; });
log(`${avenues.length} avenue corridors (N-S), ${streetRuns.length} street runs (E-W)`);

// Road graph: split every way's point run at nodes shared with other ways (real intersections)
const nameIds = new Map();
const names = [];
const nameId = (n) => { if (!nameIds.has(n)) { nameIds.set(n, names.length); names.push(n); } return nameIds.get(n); };
const nodeIds = new Map();
const nodes = [];
const useCount = new Map();
const wayRuns = [];
const nodeId = (osmId, x, z) => {
  if (nodeIds.has(osmId)) return nodeIds.get(osmId);
  const id = nodes.length / 2;
  nodeIds.set(osmId, id);
  nodes.push(r1(x), r1(z));
  return id;
};
for (const e of els) {
  if (e.type !== 'way' || !e.geometry) continue;
  const t = e.tags || {};
  if (!VEHICULAR.has(t.highway)) continue;
  const name = t.name || '';
  if (!name && !/^(motorway|trunk)/.test(t.highway)) continue; // unnamed service tracks stay paint-only
  const kept = e.geometry.map((p) => [p, toWorld(p.lon, p.lat)]).filter(([, wpt]) => wpt[0] >= wx0 - 20 && wpt[0] <= wx1 + 20 && wpt[1] >= wz0 - 20 && wpt[1] <= wz1 + 20);
  if (kept.length < 2) continue;
  const ids = kept.map(([p, wpt]) => nodeId(p.id ?? `p${p.lon.toFixed(7)},${p.lat.toFixed(7)}`, wpt[0], wpt[1]));
  for (const id of ids) useCount.set(id, (useCount.get(id) || 0) + 1);
  wayRuns.push({ t, ids, pts: kept.map(([, wpt]) => wpt) });
}
const graphLinks = [];
for (const { t, ids, pts } of wayRuns) {
  // cut at every shared node (used by more than one way) so links end at real intersections
  const cuts = [];
  for (let i = 1; i < ids.length; i++) if (useCount.get(ids[i]) > 1) cuts.push(i);
  if (cuts[cuts.length - 1] !== ids.length - 1) cuts.push(ids.length - 1);
  const name = t.name || '';
  const hw = /^(motorway|trunk)/.test(t.highway) ? 1 : 0;
  const dir = t.oneway === 'yes' ? 1 : t.oneway === '-1' ? -1 : 0;
  let prev = 0;
  for (const cut of cuts) {
    if (cut - prev < 1) { prev = cut; continue; }
    const a = ids[prev], b = ids[cut];
    if (a !== b) {
      const line = rdp(pts.slice(prev, cut + 1), 0.4);
      graphLinks.push([a, b, nameId(name), r1(roadW(t)), parseInt(t.lanes || '0', 10) || 0, dir, hw, line.slice(1, -1).flatMap(([x, z]) => [r1(x), r1(z)])]);
    }
    prev = cut;
  }
}
// keep only the nodes the links use, renumbered (as tools/geo-roadgraph.mjs)
const used = new Map();
const outNodes = [];
const outLinks = [];
for (const [a, b, n, w, lanes, dir, hw, inner] of graphLinks) {
  const idOf = (i) => { if (!used.has(i)) { used.set(i, outNodes.length / 2); outNodes.push(nodes[i * 2], nodes[i * 2 + 1]); } return used.get(i); };
  outLinks.push([idOf(a), idOf(b), n, w, lanes, dir, inner]);
}
log(`road graph: ${outNodes.length / 2} nodes, ${outLinks.length} links, ${names.length} street names`);


// =====================================================================================================================
// 5b. LAND & BARRIOS — the phase box minus the real water polygons (the Manzanares, Madrid Río, ponds): the land
//     rings are what the ground deck is built from, so the river is real geometry, never a decorative lake.
//     Barrios come from the administrative boundaries (admin_level=9) when tools/madrid/fetch.sh got them.
// =====================================================================================================================
// Water is clipped to the phase box (Sutherland-Hodgman against the four box edges) so every polygon is a valid
// hole in the ground deck. A channel that leaves and re-enters the frame becomes a band along the frame edge, which
// is exactly what the cut looks like.
function clipWater(ring, x0, z0, x1, z1) {
  let out = ring;
  const clip = (pts, keep, axis) => {
    const res = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const da = keep * (a[axis] - (keep > 0 ? (axis === 0 ? x0 : z0) : (axis === 0 ? x1 : z1)));
      const db = keep * (b[axis] - (keep > 0 ? (axis === 0 ? x0 : z0) : (axis === 0 ? x1 : z1)));
      if (da >= 0) res.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        res.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return res;
  };
  out = clip(out, 1, 0);
  out = clip(out, -1, 0);
  out = clip(out, 1, 1);
  out = clip(out, -1, 1);
  return out.length >= 3 ? out : null;
}
// Clip a ring to every core rectangle: a polygon that crosses a tile seam is split, each half owned by its tile, so
// two adjacent tiles never draw the same ground/lawn/water twice (no z-fighting, no double grass).
const clipToCore = (ring, minArea = 150) => {
  const out = [];
  for (const [x0, z0, x1, z1] of CORE) {
    const c = clipWater(ring, x0, z0, x1, z1);
    if (!c) continue;
    const simp = rdpRing(c, 0.8);
    if (simp.length < 3 || Math.abs(ringArea(simp)) < minArea) continue;
    if (ringArea(simp) > 0) simp.reverse();
    out.push(simp);
  }
  return out;
};
const waterClipped = water.flatMap((ring) => clipToCore(ring));
const waterInBox = waterClipped.reduce((t, r) => t + Math.abs(ringArea(r)), 0);
log(`water clipped to the core: ${waterClipped.length} polygons, ${(waterInBox / 1e6).toFixed(3)} km2 inside`);
// The seed must carry the Manzanares; a tile may legitimately have no water at all (e.g. the Retiro).
if (!waterClipped.length && !IS_TILE) throw new Error('no water inside the box: the Manzanares is missing from the extract');

// Parks/lawns clipped to the core for the same reason (the Manzanares channel is cut out of Madrid Río here).
const parksClipped = [];
for (const p of parks) {
  const rings = p.rings.flatMap((r) => clipToCore(r, 40));
  if (!rings.length) continue;
  parksClipped.push({ name: p.name, cat: p.cat, acres: Math.round(rings.reduce((t, r) => t + Math.abs(ringArea(r)), 0) / 404.686) / 10, rings });
}
log(`parks clipped to the core: ${parksClipped.length} surfaces, ${(parksClipped.reduce((t, p) => t + p.acres, 0) / 100).toFixed(2)} km2`);

const barrios = [];
const BARRIOS_FILE = path.join(DATA, 'barrios.json');
if (fs.existsSync(BARRIOS_FILE)) {
  const bd = JSON.parse(fs.readFileSync(BARRIOS_FILE, 'utf8'));
  const rels = (bd.elements || []).filter((e) => e.type === 'relation' && e.members);
  // Barrios of Madrid are admin_level=10, distritos admin_level=9: use the finest level the extract carries.
  const level = rels.some((e) => (e.tags || {}).admin_level === '10') ? '10' : '9';
  for (const e of rels) {
    const t = e.tags || {};
    const name = t.name || '';
    if (!name || t.boundary !== 'administrative' || t.admin_level !== level) continue;
    const rings = stitchOuterRings(e.members).map((raw) => rdpRing(raw.map((p) => toWorld(p.lon, p.lat)), 2.5))
      .filter((r) => Math.abs(ringArea(r)) > 5000);
    if (!rings.length) continue;
    const ring = rings.reduce((a, r) => (Math.abs(ringArea(r)) > Math.abs(ringArea(a)) ? r : a));
    if (ringArea(ring) > 0) ring.reverse();
    const bb = bbox(ring);
    barrios.push({ name, ring, x0: bb.x0, x1: bb.x1, z0: bb.z0, z1: bb.z1, cx: (bb.x0 + bb.x1) / 2, cz: (bb.z0 + bb.z1) / 2 });
  }
}
log(`${barrios.length} barrios from admin boundaries${barrios.length ? `: ${barrios.map((b) => b.name).join(', ')}` : ' (none: run fetch.sh for barrios.json)'}`);

// =====================================================================================================================
// 6. Assemble GEO — same schema keys the NYC runtime consumes (city-config & co), plus Madrid
//    additions (`parcels`, `water`, `plazasMadrid`) the Madrid city-config rewrite will use.
//    NYC-only keys are stubbed safe/empty so unedited NYC code can never invent Manhattan.
// =====================================================================================================================
const CUT_Z = r1(wz0); // north edge of the phase box (detail cut, NYC equivalent)
const GEO = {
  version: 1,
  phase: phase.name,
  frame: { bearingDeg: 0, origin: 'Puerta del Sol', units: 'm', cutZ: CUT_Z, strip: 0, sidewalk: 4.0, madrid: true },
  // "coastline" = the phase box (the frame cut). The real water is GEO.water: the ground deck is built with each of
  // those polygons as a hole, so the Manzanares channel is a real hole in the city, not a rectangle.
  manhattan: flat([[wx0, wz0], [wx1, wz0], [wx1, wz1], [wx0, wz1]]),
  landRings: [flat([[wx0, wz0], [wx1, wz0], [wx1, wz1], [wx0, wz1]])],
  upperManhattan: flat([[wx0, wz0 - 4000], [wx1, wz0 - 4000], [wx1, wz0], [wx0, wz0]]),
  // N-S corridors ( avenidas ) & E-W arterials, consumed by the Madrid city-config rewrite
  streets: streetRuns.map(({ n, label, z, w, lanes, dir, hw, segs }) => [n, label, z, w, lanes, dir, hw, segs]),
  avenues: avenues.map(({ id, label, x, width, lanes, dir, hw, segs }) => [id, label, x, width, lanes, dir, hw, segs]),
  // Barrios as [name, x0, x1, z0, z1] (bounding boxes of the real administrative boundaries; districtAt also tests
  // the polygons in `barrios`). Falls back to coarse rects around Sol / Gran Vía when boundaries were not fetched.
  districts: barrios.length
    ? barrios.map((b) => [b.name, r1(b.x0), r1(b.x1), r1(b.z0), r1(b.z1)])
    : [
      ['Sol', -200, 250, -150, 150], ['Gran Vía', -650, 350, -400, -120], ['Chueca', -350, 400, -700, -250],
      ['Justicia', -300, 450, -500, -150], ['Cortes', 150, 550, -50, 350], ['Huertas', 200, 550, 100, 550],
      ['La Latina', -900, -350, 150, 650], ['Austrias', -700, -150, 100, 500], ['Lavapiés', 300, 800, 300, 800],
      ['Universidad', -800, -300, -700, -250], ['Embajadores', 200, 700, 500, 900], ['Jerónimos', 450, 950, -100, 300],
    ],
  barrios: barrios.map((b) => ({ name: b.name, ring: flat(b.ring), cx: r1(b.cx), cz: r1(b.cz) })),
  broadway: flat([[wx0 + (wx1 - wx0) / 2, wz0], [wx0 + (wx1 - wx0) / 2, wz1]]), // neutral spine; Madrid config replaces getBroadwayX
  plazas: [],
  roads: roadLines.map((r) => [r.name, r1(r.w), r.dir, r.lanes, r.hw, flat(r.pts)]),
  roadGraph: { nodes: outNodes, links: outLinks, names },
  blocks: blocks.map((b) => [flat(b.ring), b.rects, 0, '', 0, 0]),
  parcels: blocks.map((b) => b.parcels.map((p) => ({ ring: flat(p.ring), h: p.h }))),
  parks: parksClipped.map((p) => ({ name: p.name, cat: p.cat, acres: p.acres, rings: p.rings.map(flat) })),
  water: waterClipped.map(flat),
  plazasMadrid: [
    ...plazas.map((p) => ({ name: p.name, ring: flat(p.ring) })),
    ...PLAZA_NAMES.filter((n) => landmarks[n] && landmarks[n].ring.length > 6).map((n) => ({ name: n, ring: landmarks[n].ring })),
  ],
  centralPark: { bounds: { minX: 1, maxX: 2, minZ: 1, maxZ: 2 }, outline: [], water: [], lawns: [], drives: [], paths: [], sites: [] },
  piers: [],
  islands: {},
  // NYC borough stubs far off-map only so unedited import-time code survives without inventing Manhattan;
  // the Madrid config rewrite replaces boroughs/bridges/piers entirely (MADRID.md).
  boroughs: {
    brooklyn: [flat([[wx1 + 3000, wz1 + 3000], [wx1 + 3200, wz1 + 3000], [wx1 + 3200, wz1 + 3200], [wx1 + 3000, wz1 + 3200]])],
    queens: [flat([[wx0 - 3200, wz1 + 3000], [wx0 - 3000, wz1 + 3000], [wx0 - 3000, wz1 + 3200], [wx0 - 3200, wz1 + 3200]])],
    bronx: [flat([[wx0 - 3200, wz0 - 3200], [wx0 - 3000, wz0 - 3200], [wx0 - 3000, wz0 - 3000], [wx0 - 3200, wz0 - 3000]])],
    statenIsland: [flat([[wx1 + 3000, wz0 - 3200], [wx1 + 3200, wz0 - 3200], [wx1 + 3200, wz0 - 3000], [wx1 + 3000, wz0 - 3000]])],
    newJersey: [flat([[wx0 - 5200, wz0 - 2000], [wx0 - 5000, wz0 - 2000], [wx0 - 5000, wz1 + 4000], [wx0 - 5200, wz1 + 4000]])]
  },
  bridges: {},
  landmarks,
  // NYC-only POI anchors: parked far south of the phase box so Battery/ferry code builds nothing visible
  points: { castleClinton: [0, wz1 + 6000], whitehallTerminal: [0, wz1 + 6000], peterMinuitPlaza: [0, wz1 + 6000] },
};

// ---------------------------------------------------------------------------------------------------------------------
// Output: js/madrid-geodata.js (core GEO) + js/madrid-geodata-blocks.js (block slabs & cadastral parcels). The block
// layer is the bulk of the data and is split out so both files stay parseable/reviewable and the browser can fetch
// them in parallel (same contract: `import { GEO } from './madrid-geodata.js'`).
// ---------------------------------------------------------------------------------------------------------------------
const core = { ...GEO };
const blockLayer = { blocks: core.blocks, parcels: core.parcels };
core.blocks = [];
core.parcels = [];

const OUT_DIR = path.dirname(OUT);
const BLOCKS_OUT = path.join(OUT_DIR, 'madrid-geodata-blocks.js');
const credits = `// Building footprints & heights: Ayuntamiento de Madrid IDEAM EDIFICIOS_ALTURAS (© Ayuntamiento de Madrid).
// Streets, parks, water, barrios & landmark footprints: © OpenStreetMap contributors (ODbL). See MADRID.md.`;

// ---------------------------------------------------------------------------------------------------------------------
// Phase-3 tile output: one self-contained module per tile (js/geodata/tile-<id>.js) exporting `TILE`. It carries only
// what the streaming renderer draws — core rectangles (ownership & ground), block slabs with their cadastral parcels,
// parks, water, landmark footprints and the roads that carry bridge decks — with every feature owned by this core.
// ---------------------------------------------------------------------------------------------------------------------
if (IS_TILE) {
  const TILE = {
    id: phase.tile.id,
    label: phase.label,
    core: CORE.map((r) => r.map(r1)),
    frame: { bbox: [r1(wx0), r1(wz0), r1(wx1), r1(wz1)], bearingDeg: 0, origin: 'Puerta del Sol', units: 'm' },
    blocks: blockLayer.blocks,
    // Flat parcel list owned by this core (the tile renderer extrudes each real contour; ownership by the
    // parcel's own centre keeps every footprint in exactly one tile, whatever block its raster merged into).
    // Geographic centre owns facades independently of changing block traces. Older neighbour modules keep
    // their historical seam parcels; exclude those exact rings while building the seven added cells.
    parcels: parcels.filter((p) => inCore(p.cx, p.cz) && !legacyParcels.has(flat(p.ring).join(',')))
      .map((p) => ({ ring: flat(p.ring), h: p.h,
        ...(p.holes.length ? { holes: p.holes.map(flat) } : {}) })),
    parks: parksClipped.map((p) => ({ name: p.name, cat: p.cat, acres: p.acres, rings: p.rings.map(flat) })),
    water: waterClipped.map(flat),
    roads: roadLines.map((r) => [r.name, r1(r.w), r.dir, r.lanes, r.hw, flat(r.pts)]),
    roadGraph: { nodes: outNodes, links: outLinks, names },
    streetPoints,
    landmarks,
  };
  fs.writeFileSync(OUT, `// ${path.relative(path.resolve(OUT_DIR, '../..'), OUT)} — GENERATED by tools/madrid/build.mjs, do not edit by hand.
// Phase-3 tile ${TILE.id}: ${phase.label}. Real geometry, owned by this tile's core ${JSON.stringify(TILE.core)}; it is
// loaded on demand by js/madrid-tiles.js (see MADRID.md). Sources: ${SOURCES.join('; ')}.
${credits}
export const TILE = ${JSON.stringify(TILE)};
`);
  log(`wrote ${path.basename(OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB): ${TILE.blocks.length} blocks, ${TILE.parcels.length} parcels, ${TILE.parks.length} parks, ${TILE.water.length} water, ${TILE.roads.length} roads, ${Object.keys(TILE.landmarks).length} landmarks`);
  process.exit(0);
}

fs.writeFileSync(BLOCKS_OUT, `// js/madrid-geodata-blocks.js — GENERATED by tools/madrid/build.mjs, do not edit by hand.
// Phase ${phase.name}: ${phase.label}. Block slabs recovered from the cadastral parcels + every parcel with its IDEAM height (m).
${credits}
export const BLOCKS = ${JSON.stringify(blockLayer.blocks)};
export const PARCELS = ${JSON.stringify(blockLayer.parcels)};
`);

const header = `// js/madrid-geodata.js — GENERATED by tools/madrid/build.mjs, do not edit by hand.
// Real Madrid geography in the simulation's world frame: 1 unit = 1 m, x = east, z = south (north = -z),
// origin at Puerta del Sol, no rotation (bearingDeg 0). Phase ${phase.name}: ${phase.label}.
${credits}
import { BLOCKS, PARCELS } from './madrid-geodata-blocks.js';

export const GEO = `;
fs.writeFileSync(OUT, `${header}${JSON.stringify(core)};\nGEO.blocks = BLOCKS;\nGEO.parcels = PARCELS;\n`);

for (const f of [OUT, BLOCKS_OUT]) log(`wrote ${path.basename(f)} (${(fs.statSync(f).size / 1024).toFixed(0)} KB)`);
for (const [k, v] of Object.entries(core)) log(`  ${k}: ${(JSON.stringify(v).length / 1024).toFixed(0)} KB`);
log(`  blocks: ${(JSON.stringify(blockLayer.blocks).length / 1024).toFixed(0)} KB, parcels: ${(JSON.stringify(blockLayer.parcels).length / 1024).toFixed(0)} KB`);
