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
import { Raster, rdp, rdpRing, ringArea, bbox, r1, log } from '../geo-base.mjs';
import { getPhase } from './config.mjs';

const DATA = process.env.GEO_DATA || fileURLToPath(new URL('../../tools/data/madrid/', import.meta.url));
const OUT = process.argv[2] || fileURLToPath(new URL('../../js/madrid-geodata.js', import.meta.url));
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const phase = getPhase();
log(`phase ${phase.name} (${phase.label})`);

// =====================================================================================================================
// 1. FRAME — UTM 30N (EPSG:25830) translation, no rotation. WGS<->UTM via the standard transverse
//    Mercator series (Snyder), WGS84 ellipsoid — sub-cm error at city scale.
// =====================================================================================================================
const A = 6378137.0, F = 1 / 298.257223563, E2 = 2 * F - F * F, EP2 = E2 / (1 - E2);
const K0 = 0.9996, LON0 = -3 * Math.PI / 180;
const SOL = [-3.7037900, 40.4167750]; // Puerta del Sol

function utmForward(lon, lat) {
  const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
  const sp = Math.sin(phi), cp = Math.cos(phi), tp = Math.tan(phi);
  const N = A / Math.sqrt(1 - E2 * sp * sp);
  const T = tp * tp, C = EP2 * cp * cp;
  const M = A * ((1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256) * phi
    - (3 * E2 / 8 + 3 * E2 * E2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * E2 * E2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * E2 ** 3 / 3072) * Math.sin(6 * phi));
  const dl = lam - LON0;
  const a2 = dl * cp;
  const x = K0 * N * (a2 + (1 - T + C) * a2 ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * a2 ** 5 / 120) + 500000;
  const y = K0 * (M + N * tp * (a2 * a2 / 2 + (5 - T + 9 * C + 4 * C * C) * a2 ** 4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * a2 ** 6 / 720));
  return [x, y];
}
const [SOLX, SOLY] = utmForward(SOL[0], SOL[1]);
// world x = UTM east, world z = grid south (north = -z)
const toWorld = (lon, lat) => { const [e, n] = utmForward(lon, lat); return [e - SOLX, SOLY - n]; };
const utmToWorld = (x, y) => [x - SOLX, SOLY - y];

// phase bbox in world coordinates (from the UTM corners)
const [bx0, by0, bx1, by1] = phase.utm;
const [wx0, wz1] = utmToWorld(bx0, by0);
const [wx1, wz0] = utmToWorld(bx1, by1);
log(`world bbox x [${wx0.toFixed(0)}, ${wx1.toFixed(0)}] z [${wz0.toFixed(0)}, ${wz1.toFixed(0)}] (${((wx1 - wx0) / 1000).toFixed(2)} x ${((wz1 - wz0) / 1000).toFixed(2)} km)`);

const flat = (pts) => pts.flatMap(([x, z]) => [r1(x), r1(z)]);

// =====================================================================================================================
// 2. OSM — roads, parks & water, squares, named landmark footprints
// =====================================================================================================================
const osm = load('osm_madrid.json');
const els = osm.elements || [];

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
log(`${roadLines.length} road polylines, ${roadLines.filter((r) => r.name).length} named`);

// parks, water & pedestrian squares (ground colouring + GEO.parks)
const areaKind = (t) => {
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park';
  if (t.natural === 'water' || t.waterway) return 'water';
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
log(`${parks.length} parks, ${water.length} water bodies, ${plazas.length} plazas/squares`);

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
  const ring = rdpRing(g.map(([x, y]) => utmToWorld(x, y)), 0.4);
  if (Math.abs(ringArea(ring)) < 12) continue; // kiosks & sheds
  const bb = bbox(ring);
  if (bb.x1 - bb.x0 < 1.2 || bb.z1 - bb.z0 < 1.2) continue;
  if (ringArea(ring) > 0) ring.reverse();
  parcels.push({ ring, h: Math.max(2.4, Math.round(h * 10) / 10) });
}
log(`${parcels.length} real building parcels (IDEAM alturas)`);

// label connected components of the parcel raster, then trace each component's outer ring
const RES = 2;
const ras = new Raster(wx0 - 4, wz0 - 4, wx1 + 4, wz1 + 4, RES);
for (const p of parcels) ras.fillRing(p.ring, 1);
ras.close(4); // patios < 8 m across and gaps to the neighbour merge into the slab
ras.open(9);  // drop slivers
{
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
  var blockRings = [];
  for (const cells of compCells) {
    if (cells.length < 60) continue; // < ~240 m² of footprint
    let i0 = w, j0 = h, i1 = 0, j1 = 0;
    for (const c of cells) { const i = c % w, j = (c / w) | 0; if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
    const sub = new Raster(ras.x0 + i0 * RES, ras.z0 + j0 * RES, ras.x0 + (i1 + 1) * RES, ras.z0 + (j1 + 1) * RES, RES);
    for (const c of cells) sub.d[(((c / w) | 0) - j0) * sub.w + ((c % w) - i0)] = 1;
    const ring = sub.traceOuter();
    if (Math.abs(ringArea(ring)) < 250) continue;
    if (ringArea(ring) > 0) ring.reverse();
    blockRings.push(rdpRing(ring, 0.8));
  }
}
log(`merged into ${blockRings.length} block slabs`);
const blocks = [];
for (const ring of blockRings) {
  const bb = bbox(ring);
  const mine = [];
  for (const p of parcels) {
    const cx = p.ring.reduce((t, q) => t + q[0], 0) / p.ring.length;
    const cz = p.ring.reduce((t, q) => t + q[1], 0) / p.ring.length;
    if (cx > bb.x0 && cx < bb.x1 && cz > bb.z0 && cz < bb.z1) mine.push(p);
  }
  const id = blocks.length;
  blocks.push({ id, ring, parcels: mine });
  for (const p of mine) p.block = id;
}
log(`${blocks.length} blocks kept, ${blocks.reduce((t, b) => t + b.parcels.length, 0)} parcels attached`);

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
]);
const landmarks = {};
// POI nodes (fountains, statues, clocks, memorials): points, extruder can skip but map/teleport use them
for (const e of els) {
  if (e.type !== 'node') continue;
  const t = e.tags || {};
  const name = t.name || t['name:es'] || '';
  if (!name) continue;
  const isPOI = t.historic === 'monument' || t.historic === 'memorial' || t.amenity === 'fountain' || t.amenity === 'clock' ||
    t.tourism === 'artwork' || t.tourism === 'attraction' || t.man_made === 'obelisk' || t.man_made === 'tower' || t.man_made === 'cross';
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
  landmarks[name] = { ring: flat(big), cx: r1((bb.x0 + bb.x1) / 2), cz: r1((bb.z0 + bb.z1) / 2), w: r1(bb.x1 - bb.x0), d: r1(bb.z1 - bb.z0), h: h ? Math.round(h * 10) / 10 : undefined };
}
// The big squares we name teleports after (OSM splits them across many open/fragmented ways):
// merge every fragment of the same name into one footprint (union bbox + outer hull ring)
const PLAZA_NAMES = ['Plaza de la Cibeles', 'Plaza de Callao', 'Plaza de la Puerta del Sol', 'Plaza Mayor', 'Plaza de la Villa', 'Plaza de la Independencia'];
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
  const isArea = t.building || t.place === 'square' || t.historic || t.tourism || t.amenity === 'fountain' || t.man_made;
  if (!isArea) continue;
  const pts = e.geometry.filter((p) => p).map((p) => toWorld(p.lon, p.lat));
  if (pts.length < 3) continue;
  const ring = rdpRing(pts, 0.6);
  if (Math.abs(ringArea(ring)) < 30) continue;
  if (ringArea(ring) > 0) ring.reverse();
  const bb = bbox(ring);
  const h = parseFloat(t.height || '') || (parseInt(t['building:levels'] || '0', 10) ? parseInt(t['building:levels'], 10) * 3.6 : 0);
  landmarks[name] = { ring: flat(ring), cx: r1((bb.x0 + bb.x1) / 2), cz: r1((bb.z0 + bb.z1) / 2), w: r1(bb.x1 - bb.x0), d: r1(bb.z1 - bb.z0), h: h ? Math.round(h * 10) / 10 : undefined };
}
log(`${Object.keys(landmarks).length} landmark footprints: ${Object.keys(landmarks).join(', ') || '(none)'}`);

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
  const ids = kept.map(([p, wpt]) => nodeId(p.id ?? `s${e.id}x${p.lon.toFixed(6)}x${p.lat.toFixed(6)}`, wpt[0], wpt[1]));
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
// 6. Assemble GEO — same schema keys the NYC runtime consumes (city-config & co), plus Madrid
//    additions (`parcels`, `water`, `plazasMadrid`) the Madrid city-config rewrite will use.
//    NYC-only keys are stubbed safe/empty so unedited NYC code can never invent Manhattan.
// =====================================================================================================================
const CUT_Z = r1(wz0); // north edge of the phase box (detail cut, NYC equivalent)
const GEO = {
  version: 1,
  phase: phase.name,
  frame: { bearingDeg: 0, origin: 'Puerta del Sol', units: 'm', cutZ: CUT_Z, strip: 0, sidewalk: 4.0, madrid: true },
  // "coastline" = phase bbox ring: the land surface the city builds on
  manhattan: flat([[wx0, wz0], [wx1, wz0], [wx1, wz1], [wx0, wz1]]),
  upperManhattan: flat([[wx0, wz0 - 4000], [wx1, wz0 - 4000], [wx1, wz0], [wx0, wz0]]),
  // N-S corridors ( avenidas ) & E-W arterials, consumed by the Madrid city-config rewrite
  streets: streetRuns.map(({ n, label, z, w, lanes, dir, hw, segs }) => [n, label, z, w, lanes, dir, hw, segs]),
  avenues: avenues.map(({ id, label, x, width, lanes, dir, hw, segs }) => [id, label, x, width, lanes, dir, hw, segs]),
  // barrios as [name, x0, x1, z0, z1]; Sol around the origin, Gran Vía band north of it
  districts: [
    ['Sol', -200, 250, -150, 150], ['Gran Vía', -650, 350, -400, -120], ['Chueca', -350, 400, -700, -250],
    ['Justicia', -300, 450, -500, -150], ['Cortes', 150, 550, -50, 350], ['Huertas', 200, 550, 100, 550],
    ['La Latina', -900, -350, 150, 650], ['Austrias', -700, -150, 100, 500], ['Lavapiés', 300, 800, 300, 800],
    ['Universidad', -800, -300, -700, -250], ['Embajadores', 200, 700, 500, 900], ['Jerónimos', 450, 950, -100, 300],
  ],
  broadway: flat([[wx0 + (wx1 - wx0) / 2, wz0], [wx0 + (wx1 - wx0) / 2, wz1]]), // neutral spine; Madrid config replaces getBroadwayX
  plazas: [],
  roads: roadLines.map((r) => [r.name, r1(r.w), r.dir, r.lanes, r.hw, flat(r.pts)]),
  roadGraph: { nodes: outNodes, links: outLinks, names },
  blocks: blocks.map((b) => [flat(b.ring), [], 0, '', 0, 0]),
  parcels: blocks.map((b) => b.parcels.map((p) => ({ ring: flat(p.ring), h: p.h }))),
  parks: parks.map((p) => ({ name: p.name, cat: p.cat, acres: Math.round(p.acres * 10) / 10, rings: p.rings.map(flat) })),
  water: water.map(flat),
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

const json = JSON.stringify(GEO);
const header = `// js/madrid-geodata.js — GENERATED by tools/madrid/build.mjs, do not edit by hand.
// Real Madrid geography in the simulation's world frame: 1 unit = 1 m, x = east, z = south (north = -z),
// origin at Puerta del Sol, no rotation (bearingDeg 0). Phase ${phase.name}: ${phase.label}.
// Building footprints & heights: Ayuntamiento de Madrid IDEAM EDIFICIOS_ALTURAS (© Ayuntamiento de Madrid).
// Streets, parks, water & landmark footprints: © OpenStreetMap contributors (ODbL). See MADRID.md.
export const GEO = `;
fs.writeFileSync(OUT, `${header}${json};\n`);
log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
for (const [k, v] of Object.entries(GEO)) log(`  ${k}: ${(JSON.stringify(v).length / 1024).toFixed(0)} KB`);
