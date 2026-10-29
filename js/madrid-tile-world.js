// js/madrid-tile-world.js — phase-3 tile renderer: turns a generated tile module (js/geodata/tile-<id>.js, see
// tools/madrid/build.mjs + tools/madrid/tiles.mjs) into scene geometry, and takes it out again on eviction.
//
// The seed tile (phase 2) keeps the full procedural city of js/madrid-geodata.js. Tiles are rendered at the same
// 1:1 frame with the same facades, paving and water, one level of detail below the seed: every IDEAM parcel becomes
// one facade box of its real height inside its real block slab (the seed masses a block into tiers/steps from the
// same parcels). Everything here is real geometry owned by the tile core; polygons crossing a seam were already
// clipped by the builder, so adjacent tiles never draw the same surface twice.
import * as THREE from 'three/webgpu';
import { createSourcedStreetTrees } from './madrid-street-trees.js';
import { Fn, abs, color, fract, max, mix, positionGeometry, positionWorld, smoothstep } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createExtrudedPolygonMesh, createFlatPolygonMesh, offsetPolygonInward } from './city-grid.js';
import {
  WALL_KINDS,
  createCurbMaterial,
  createFacadeBoxes,
  createParkLawnMaterial,
  createRoadSurfaceMaterial,
  createSidewalkMaterial,
  createWaterMaterial
} from './tsl-materials.js';
import { FACADE_DEFS } from './buildings.js';
import { partyWallHeights, partyWallRuns, exposedPartyWallSides } from './madrid-adjacency.js';
import { tileRoofInstances } from './madrid-roofs.js';
import { decomposeRing } from './madrid-footprint.js';
import { MADRID_FACADE_OPTS, MADRID_LANDMARK_STYLES } from './madrid-tiles.js';

// Tejados: shared terracotta material + palette (Tiny-Madrid illustrated references, user-chosen).
// Geometry is per tile (eviction disposes mesh.geometry); materials stay alive like facades.
const hipRoofMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide });
hipRoofMat.colorNode = Fn(() => {
  const course = smoothstep(0.35, 0.65, fract(positionGeometry.y.mul(22.0)));
  return mix(color(0xffffff), color(0xd8cec6), course.mul(0.14));
})();
const HIP_PALETTE = [0xb0512b, 0xbc5f33, 0xa6492a, 0xc06a3d, 0x9a5238].map((c) => new THREE.Color(c));
const HIP_SLATE = new THREE.Color(0x5d646e);
const HIP_GEO_TRIS = new Float32Array([
  -0.5, 0, -0.5, 0.5, 0, -0.5, 0.25, 1, 0,
  -0.5, 0, -0.5, 0.25, 1, 0, -0.25, 1, 0,
  0.5, 0, 0.5, -0.5, 0, 0.5, -0.25, 1, 0,
  0.5, 0, 0.5, -0.25, 1, 0, 0.25, 1, 0,
  -0.5, 0, 0.5, -0.5, 0, -0.5, -0.25, 1, 0,
  0.5, 0, -0.5, 0.5, 0, 0.5, 0.25, 1, 0
]);
const RING_GEO_TRIS = (() => {
  const k1 = 0.16, k2 = 0.30, yi = 0.45;
  const O = 0.5, R = 0.5 - k1, I = 0.5 - k2;
  const A = [-O, 0, -O], B = [O, 0, -O], C = [O, 0, O], D = [-O, 0, O];
  const RA = [-R, 1, -R], RB = [R, 1, -R], RC = [R, 1, R], RD = [-R, 1, R];
  const IA = [-I, yi, -I], IB = [I, yi, -I], IC = [I, yi, I], ID = [-I, yi, I];
  const tri = [];
  const quad = (p, q, r, s) => { tri.push(...p, ...q, ...r, ...p, ...r, ...s); };
  const o = [A, B, C, D], rg = [RA, RB, RC, RD], inr = [IA, IB, IC, ID];
  for (let s = 0; s < 4; s++) {
    const t = (s + 1) % 4;
    quad(o[s], o[t], rg[t], rg[s]);
    quad(rg[s], rg[t], inr[t], inr[s]);
  }
  return new Float32Array(tri);
})();

const toPts = (flat) => {
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], z: flat[i + 1] });
  return out;
};
const rectPts = ([x0, z0, x1, z1]) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const shoelace = (pts) => {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  return s;
};
const pointInRing = (ring, x, z) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
};
const bboxOf = (pts) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  return { x0, x1, z0, z1 };
};
const hash = (x, z, salt = 0) => {
  const v = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * "Out of map" ground: what a tile that has not been streamed in yet shows. A neutral dark paving with a survey
 * grid and a hazard tint — never city asphalt/grass, so a pending area can't be mistaken for empty city.
 */
function createOutOfMapFloor(scene, bbox) {
  const pad = 3000;
  const w = (bbox[2] - bbox[0]) + pad * 2;
  const d = (bbox[3] - bbox[1]) + pad * 2;
  const geo = new THREE.PlaneGeometry(w, d, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  mat.colorNode = Fn(() => {
    const p = positionWorld.xz;
    const grid = (stepM) => {
      const f = abs(fract(p.div(stepM)).sub(0.5));
      return max(smoothstep(0.455, 0.5, f.x), smoothstep(0.455, 0.5, f.y));
    };
    const minor = grid(50).mul(0.55);
    const major = grid(250);
    const base = color(0x1d2127);
    const tint = color(0x2a3138);
    const line = color(0x3d4650);
    return mix(mix(base, tint, minor), line, major);
  })();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((bbox[0] + bbox[2]) / 2, -0.16, (bbox[1] + bbox[3]) / 2);
  mesh.receiveShadow = true;
  mesh.name = 'MadridOutOfMap';
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

export function createTileWorld(scene, { colliders = null, materials = null, seedStreetFeatures = null } = {}) {
  const farBuildingMaterial = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  // Shared materials: the facades come from the seed's own table (cached by options, so one shader compile each).
  // Madrid almendra palettes (caliza / ladrillo visto / revoco encalado, balcones rhythm) - NOT the
  // Manhattan pre-war table. Same factories, Madrid options; faces keep the storefront ground floors (comercios
  // en bajos) until road-adjacency data picks entry vs shop per wall.
  // Every Madrid tier is masonry revoco/ladrillo: always the pre-war factory. Indexing FACADE_DEFS by tier
  // was a bug: entries 3+ are NYC curtain-wall (glass) factories that ignore the Madrid palette and turned
  // tier-3 parcels into dark glass towers (caught by the real tile-path harness, block-tilepath.html).
  const facades = MADRID_FACADE_OPTS.map((opts) => FACADE_DEFS[0][0]({ ...opts, boxLocal: true, madrid: true }));
  // HYBRID-B prototype: plain tier-toned wall material for coherent holed massing (no window grid yet).
  const hybridWallMats = MADRID_FACADE_OPTS.map((o) => new THREE.MeshStandardNodeMaterial({ color: o.stoneColor, roughness: 0.95, metalness: 0 }));
  // HYBRID-B facade probe: WORLD-SPACE facade variant per tier (boxLocal omitted) - windows map by
  // world position+normal onto arbitrary wall orientations, incl. extruded concave/well walls.
  const hybridFacadeMats = MADRID_FACADE_OPTS.map((o) => FACADE_DEFS[0][0]({ ...o, madrid: true }));
  const medianeraMat = new THREE.MeshStandardNodeMaterial({ color: 0xb9a684, roughness: 0.97, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); // warmer masonry tone; sits ON the owner wall (0.01), depth via polygonOffset not displacement
  const mats = {
    road: materials?.road || createRoadSurfaceMaterial(),
    curb: materials?.curb || createCurbMaterial(),
    sidewalk: materials?.sidewalk || createSidewalkMaterial(),
    water: materials?.water || createWaterMaterial(),
    lawn: materials?.lawn || createParkLawnMaterial(false),
    stone: new THREE.MeshStandardNodeMaterial({ color: 0xc9c2b4, roughness: 0.88, metalness: 0.02 }),
    landmark: new THREE.MeshStandardNodeMaterial({ color: 0xcfc8b8, roughness: 0.85, metalness: 0.03 }),
    // Named monuments get their own material (caliza blanca / granito berroqueno), not one blanket tone.
    landmarkByName: new Map()
  };
  const streetFeatures = new Map();
  const seedTrees = createSourcedStreetTrees(seedStreetFeatures?.trees);
  if (seedStreetFeatures) {
    streetFeatures.set('fase2', seedStreetFeatures);
    scene.add(seedTrees);
  }
  const groups = new Map(); // tile id -> { group, colliders }
  // The source data of every mounted tile, for systems that need geometry outside the meshes:
  // resident routing (blocks/parcels/core) and the pedestrian block lookup. Removed with the tile.
  const tileData = new Map();
  // Footprints already in the scene: the ownership rules keep each building in exactly one tile, and this guard makes
  // that a hard invariant of the renderer (a doubled ring would be two coplanar facades in the same place).
  const drawnParcels = new Set();

  function addTile(tile) {
    if (groups.has(tile.id)) return groups.get(tile.id);
    const group = new THREE.Group();
    group.name = `MadridTile:${tile.id}`;
    const tileColliders = [];
    const core = tile.core && tile.core.length ? tile.core : [tile.frame.bbox];
    const water = (tile.water || []).map(toPts).filter((r) => r.length >= 3);
    const waterBoxes = water.map((r) => ({ ring: r, bb: bboxOf(r) }));

    // 1. Ground: each core rectangle is one asphalt slab with the real water cut out (the channel becomes a hole with
    //    a vertical bank, exactly like the seed), plus the water surface 0.45 m below the street.
    const coreRects = core.map((r) => ({ rect: r, pts: rectPts(r) }));
    for (const { rect, pts } of coreRects) {
      const holes = water.filter((r) => {
        const c = r.reduce((a, p) => ({ x: a.x + p.x / r.length, z: a.z + p.z / r.length }), { x: 0, z: 0 });
        return c.x >= rect[0] && c.x <= rect[2] && c.z >= rect[1] && c.z <= rect[3];
      });
      const deck = createExtrudedPolygonMesh(pts, -0.6, 0.6, mats.road, true, false, holes.length ? holes : null);
      deck.name = 'TileDeck';
      group.add(deck);
    }
    for (const ring of water) {
      const plane = createFlatPolygonMesh(ring, -0.45, mats.water, true);
      plane.name = 'TileWater';
      group.add(plane);
    }

    // 2. Parks & gardens: real OSM landuse, clipped to the core by the builder; the channel is cut out of them too.
    const lawnGeos = [];
    for (const park of tile.parks || []) {
      for (const flat of park.rings || []) {
        const ring = toPts(flat);
        if (ring.length < 3) continue;
        const bb = bboxOf(ring);
        const holes = waterBoxes.filter((w) => w.bb.x1 > bb.x0 && w.bb.x0 < bb.x1 && w.bb.z1 > bb.z0 && w.bb.z0 < bb.z1).map((w) => w.ring);
        lawnGeos.push(createFlatPolygonMesh(ring, 0.10, mats.lawn, true, holes.length ? holes : null).geometry);
      }
    }
    if (lawnGeos.length) {
      const merged = mergeGeometries(lawnGeos, false);
      for (const g of lawnGeos) g.dispose();
      const mesh = new THREE.Mesh(merged, mats.lawn);
      mesh.receiveShadow = true;
      mesh.name = 'TileParks';
      group.add(mesh);
    }

    // 3. Raised sidewalks: the real block slab (cadastral parcels merged), granite curb + inset paving, as in the seed.
    const curbGeos = [];
    const walkGeos = [];
    for (const block of tile.blocks || []) {
      const ring = toPts(block[0]);
      if (ring.length < 3) continue;
      if (shoelace(ring) > 0) ring.reverse();
      curbGeos.push(createExtrudedPolygonMesh(ring, 0, 0.18, mats.curb, true, true).geometry);
      const inner = offsetPolygonInward(ring, 0.25);
      if (inner) walkGeos.push(createExtrudedPolygonMesh(inner, 0.03, 0.19, mats.sidewalk, true, false).geometry);
    }
    for (const [geos, mat, cast] of [[curbGeos, mats.curb, true], [walkGeos, mats.sidewalk, false]]) {
      if (!geos.length) continue;
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.receiveShadow = true;
      mesh.castShadow = cast;
      group.add(mesh);
    }

    // 4. Buildings: one facade box per IDEAM parcel (real footprint extent, real ALTURA) inside its block slab.
    //    Madrid medianeras: where an abutting parcel is shorter, the wall strip above its roof is a windowless
    //    party wall (WALL_KINDS.lotLine), emitted as a second stacked tier - the pre-war material already starts
    //    upper tiers with a parapet. Neighbors are found inside this tile's parcel set only; cross-tile edges
    //    keep the street-front treatment (bounded approximation).
    const items = facades.map(() => []);
    const parcels = tile.parcels || [];
    const drawnHere = [];
    const pabs = [];
    for (let index = 0; index < parcels.length; index++) {
      const parcel = parcels[index];
      const ring = toPts(parcel.ring || []);
      if (ring.length < 3 || !(parcel.h > 0)) continue;
      const key = parcel.ring.join(',');
      if (drawnParcels.has(key)) continue;
      drawnParcels.add(key);
      drawnHere.push(key);
      const bb = bboxOf(ring);
      const w = bb.x1 - bb.x0, d = bb.z1 - bb.z0;
      if (w < 2 || d < 2) continue;
      // Footprint-aware massing (prototype): decompose the real ring into rotated rectangles so
      // block-perimeter parcels stop rendering as one AABB slab over the courtyard. Fallback to the
      // AABB box when the approximation deviates too much (diagonal/curved boundaries stair-step).
      let fp = null;
      const fpEnabled = globalThis.__FP !== false; // harness A/B toggle (block-tilepath.html?fp=0)
      // EVERY parcel gets the OBB-framed treatment (prototype): simple near-rectangular rings take ONE
      // rotated box (exact for the ~40°-rotated local grid; world-AABB overcovers 83-171% here);
      // complex concave rings take strip decomposition. Fallback to AABB when deviation is high.
      {
        // One event-aligned OBB decomposition: near-rectangular rings merge down to ONE rotated box;
        // concave rings stay a set of aligned strips. dev threshold is a local working value (unapproved).
        const d0 = tile.prepared?.footprints[index] || decomposeRing(parcel.ring, { stripW: 4, minD: 0.4, holes: parcel.holes || [] });
        tile.footprintStats = tile.footprintStats || [];
        if (fpEnabled && d0.deviation <= 0.10) {
          fp = d0;
          tile.footprintStats.push({ index, mode: d0.rects.length === 1 ? 'obb' : 'strips', rects: d0.rects.length, deviation: +d0.deviation.toFixed(3), used: true });
        } else {
          tile.footprintStats.push({ index, mode: 'aabb-fallback', rects: d0.rects.length, deviation: +d0.deviation.toFixed(3), used: false });
        }
      }
      pabs.push({ x0: bb.x0, x1: bb.x1, z0: bb.z0, z1: bb.z1, w, d, h: parcel.h, index, ring: parcel.ring, holes: parcel.holes || null, fp });
      tileColliders.push({ minX: bb.x0, maxX: bb.x1, minZ: bb.z0, maxZ: bb.z1, minY: 0, maxY: parcel.h });
    }
    // Party-wall detection on the real ring footprints (js/madrid-adjacency.js): a side becomes a
    // windowless medianera tier only where shared boundary runs cover the majority of that side.
    const matchingPreparation = tile.prepared && pabs.length === tile.prepared.indices.length &&
      pabs.every((p, i) => p.index === tile.prepared.indices[i]);
    const nHArr = matchingPreparation ? tile.prepared.heights : partyWallHeights(pabs);
    const pRuns = matchingPreparation ? tile.prepared.runs : partyWallRuns(pabs); // per parcel per edge shared intervals (hybrid medianera overlays)
    const medianeraQuads = []; // {ax,az,bx,bz,h} world quads, batched into one mesh after the loop
    const mergedZone = []; // MERGED-ZONE probe: parcels collected here skip per-parcel emission below
    for (let pi = 0; pi < pabs.length; pi++) {
      const P = pabs[pi];
      const cx = (P.x0 + P.x1) / 2, cz = (P.z0 + P.z1) / 2;
      const tier = Math.floor(hash(cx, cz, P.index) * facades.length) % facades.length;
      const tone = hash(cz, cx, 3);
      const shop = WALL_KINDS.shop;
      if (globalThis.__MERGED === true) { mergedZone.push(P); continue; } // merged-zone probe owns this parcel's massing
      if (globalThis.__FP !== false && !P.fp && P.holes && P.holes.length) {
        // HYBRID-B (local prototype): coherent holed massing for the fallback cohort - the REAL
        // exterior ring extruded full-height with the REAL holes as open wells (cap/perimeter/well
        // from one source ring set). Facade = world-space tier material (windows on any orientation,
        // wells included - corrala patios have windows). Material arrays on ExtrudeGeometry rendered
        // all groups with one material in this renderer path (observed), so the azotea is a separate
        // plain-tone ring cap overlay at P.h+0.02. +2 meshes per hybrid parcel; colliders stay AABB.
        const toPts = (r) => { const o = []; for (let i = 0; i + 1 < r.length; i += 2) o.push({ x: r[i], z: r[i + 1] }); return o; };
        const solid = createExtrudedPolygonMesh(toPts(P.ring), 0, P.h, hybridFacadeMats[tier], true, true, P.holes.map(toPts));
        const cap = createFlatPolygonMesh(toPts(P.ring), P.h + 0.02, hybridWallMats[tier], true, P.holes.map(toPts));
        cap.name = 'TileHybridCap';
        group.add(cap);
        solid.name = 'TileHybridWell';
        group.add(solid);
        // Medianera overlays: blank the wall runs shared with an abutter (the world-space facade
        // glazes every wall; a party wall must be windowless up to the abutter's height). 3cm
        // outward offset, orientation by inside-test against the source ring. Batched after the loop.
        const ringPts = toPts(P.ring);
        const runs = pRuns[pi] || [];
        for (let e = 0; e < ringPts.length; e++) {
          const A = ringPts[e], B = ringPts[(e + 1) % ringPts.length];
          const L = Math.hypot(B.x - A.x, B.z - A.z);
          if (L < 0.3 || !runs[e] || !runs[e].length) continue;
          const ux = (B.x - A.x) / L, uz = (B.z - A.z) / L;
          let nx = -uz, nz = ux;
          const mx = (A.x + B.x) / 2 + nx * 0.5, mz = (A.z + B.z) / 2 + nz * 0.5;
          let ins = false;
          const rr = P.ring;
          for (let i = 0, j = rr.length - 2; i < rr.length; j = i, i += 2) {
            const xj = rr[j], zj = rr[j + 1], xi = rr[i], zi = rr[i + 1];
            if ((zi > mz) !== (zj > mz) && mx < ((xj - xi) * (mz - zi)) / (zj - zi) + xi) ins = !ins;
          }
          if (ins) { nx = -nx; nz = -nz; }
          for (const r of runs[e]) {
            const h = Math.min(P.h, r.h);
            if (h < 2) continue;
            medianeraQuads.push({
              ax: A.x + ux * L * r.t0 + nx * 0.01, az: A.z + uz * L * r.t0 + nz * 0.01,
              bx: A.x + ux * L * r.t1 + nx * 0.01, bz: A.z + uz * L * r.t1 + nz * 0.01,
              h, nx, nz });
          }
        }
        continue;
      }
      const nH = nHArr[pi];
      // Guardrail: skip when the exposed strip would exceed half the parcel's height - blanking most of a
      // tall interior tower reads as a monolith (unresolved: needs lotLine material work or street-side data)
      const exposed = exposedPartyWallSides(P, nH);
      if (!exposed.some(Boolean)) {
        if (P.fp) {
          // One rotated box per decomposition rect (bounded approx: street faces; medianera logic stays AABB-level)
          const ang = Math.atan2(P.fp.frame.uz, P.fp.frame.ux);
          for (const r of P.fp.rects) {
            const c = r.corners;
            const rw = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]);
            const rd = Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1]);
            const mx = (c[0][0] + c[2][0]) / 2, mz = (c[0][1] + c[2][1]) / 2;
            items[tier].push({ x: mx, y: P.h / 2, z: mz, w: rw, h: P.h, d: rd, tone, ry: -ang, faces: [shop, shop, shop, shop], rect: { w: rw, d: rd, x: mx, z: mz } });
          }
        } else {
          items[tier].push({ x: cx, y: P.h / 2, z: cz, w: P.w, h: P.h, d: P.d, tone, faces: [shop, shop, shop, shop] });
        }
        continue;
      }
      const nMin = Math.min(...nH.filter((n, i) => exposed[i]));
      items[tier].push({ x: cx, y: nMin / 2, z: cz, w: P.w, h: nMin, d: P.d, tone, faces: [shop, shop, shop, shop] });
      const upFaces = nH.map((n, i) => (exposed[i] && n <= nMin + 0.5 ? WALL_KINDS.lotLine : shop));
      items[tier].push({ x: cx, y: nMin + (P.h - nMin) / 2, z: cz, w: P.w, h: P.h - nMin, d: P.d, tone, faces: upFaces });
    }
    items.forEach((list, i) => {
      if (!list.length) return;
      const mesh = createFacadeBoxes(facades[i], list);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `TileBuildings${i}`;
      group.add(mesh);
    });
    if (medianeraQuads.length) {
      const pos = [], norm = [], idxArr = [];
      medianeraQuads.forEach((q, qi) => {
        const base = qi * 4;
        pos.push(q.ax, 0, q.az, q.bx, 0, q.bz, q.bx, q.h, q.bz, q.ax, q.h, q.az);
        for (let k = 0; k < 4; k++) norm.push(q.nx, 0, q.nz);
        idxArr.push(base, base + 1, base + 2, base, base + 2, base + 3);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
      g.setIndex(idxArr);
      const mm = new THREE.Mesh(g, medianeraMat);
      mm.name = 'TileMedianeraOverlay';
      mm.castShadow = true;
      mm.receiveShadow = true;
      group.add(mm);
    }

    // MERGED-ZONE probe (TinyWarsaw 'everyday-buildings' analog, own code): every parcel extruded from
    // its REAL outline with its REAL holes, merged into ONE mesh with ONE shared world-space pre-war
    // facade material (TSL; no tier lottery, no strips, no per-parcel meshes) + ONE merged flat cap mesh.
    // Party walls keep windows (the Warsaw model: no suppression observed in their code); no roof
    // furniture/hips in this probe. Toggle: block harness ?merged=1 (window.__MERGED).
    if (globalThis.__MERGED === true && mergedZone.length) {
      const toPtsMz = (r) => { const o = []; for (let i = 0; i + 1 < r.length; i += 2) o.push({ x: r[i], z: r[i + 1] }); return o; };
      // ILLUSTRATIVE per-building tints (hash palette toward the tiny-madrid references): the IDEAM
      // payload carries only {ring, h, holes} - NO real facade/roof color data. Vertex colors carry the
      // whole masonry tone (stoneColor driven to white), the caps take terracotta-ish tones.
      const MZ_TINTS = [0xf4eee2, 0xf4e2ca, 0xeedebb, 0xe8d2b5, 0xf4e8d6, 0xeedac6, 0xe5cab0, 0xf4e5da].map((h) => new THREE.Color(h));
      const MZ_CAPS = [0xc9a084, 0xc2937c, 0xcfa287, 0xbc9581, 0xc09479, 0xc79c7e, 0x9d968d, 0xb0a89b].map((h) => new THREE.Color(h));
      const tintAttr = (geo, col, capCol) => {
        const n = geo.attributes.position.count;
        const arr = new Float32Array(n * 3);
        // ExtrudeGeometry (non-indexed) emits group 0 = lids (front/back), group 1 = side walls;
        // vertex ranges follow geo.groups so lids take the cap tone and walls the masonry tint.
        const ranges = (geo.groups && geo.groups.length === 2) ? geo.groups : [{ start: 0, count: n, materialIndex: 1 }];
        for (const g of ranges) {
          const c = (g.materialIndex === 0 && capCol) ? capCol : col;
          for (let i = g.start; i < g.start + g.count && i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
        }
        geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        return geo;
      };
      const mergedFacadeMat = FACADE_DEFS[0][0]({ ...MADRID_FACADE_OPTS[0], stoneColor: 0xffffff, madrid: true, vertexTint: true });
      const mergedCapMat = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, vertexColors: true });
      const geos = [];
      for (const P of mergedZone) {
        const pcx = (P.x0 + P.x1) / 2, pcz = (P.z0 + P.z1) / 2;
        const tint = location.search.includes('tintprobe=1') ? new THREE.Color(0x2060ff) : MZ_TINTS[Math.floor(hash(pcx, pcz, P.index) * MZ_TINTS.length) % MZ_TINTS.length];
        const capTint = MZ_CAPS[Math.floor(hash(pcz, pcx, P.index + 7) * MZ_CAPS.length) % MZ_CAPS.length];
        const holes = (P.holes && P.holes.length) ? P.holes.map(toPtsMz) : null;
        // Walls+lids in ONE geometry: lids get the plain cap material via material-index groups, so no
        // facade windows can land on horizontal faces and no separate cap mesh can fail to cover them.
        geos.push(tintAttr(createExtrudedPolygonMesh(toPtsMz(P.ring), 0, P.h, mergedFacadeMat, true, true, holes).geometry, tint, capTint));
      }
      // Manual merge preserving each extrusion's 2 source groups (mergeGeometries(useGroups) would
      // re-index groups per input geometry, forcing one material slot per parcel).
      const mzGeo = new THREE.BufferGeometry();
      {
        const cat = (name, itemSize) => {
          let total = 0; for (const g of geos) total += g.attributes[name].count;
          const out = new Float32Array(total * itemSize); let off = 0;
          for (const g of geos) { out.set(g.attributes[name].array, off); off += g.attributes[name].array.length; }
          mzGeo.setAttribute(name, new THREE.BufferAttribute(out, itemSize));
        };
        cat('position', 3); cat('normal', 3); cat('uv', 2); cat('color', 3);
        let vOff = 0;
        for (const g of geos) {
          for (const gr of g.groups) mzGeo.addGroup(vOff + gr.start, gr.count, gr.materialIndex);
          vOff += g.attributes.position.count;
        }
      }
      const mz = new THREE.Mesh(mzGeo, [mergedCapMat, mergedFacadeMat]);
      mz.name = 'TileMergedZone'; mz.castShadow = true; mz.receiveShadow = true; group.add(mz);
      if (location.search.includes('debug=outline')) {
        // Source-validation overlay: magenta = parcel outline, cyan = holes, both drawn at source h + 0.3.
        const lp = [], lc = [];
        const pushRing = (r, y, col) => {
          for (let i = 0; i + 3 < r.length; i += 2) {
            lp.push(r[i], y, r[i + 1], r[i + 2], y, r[i + 3]);
            lc.push(...col, ...col);
          }
        };
        for (const P of mergedZone) {
          const rr = P.ring.slice(); rr.push(rr[0], rr[1]);
          pushRing(rr, P.h + 0.3, [1, 0, 1]);
          for (const hRing of (P.holes || [])) { const hh = hRing.slice(); hh.push(hh[0], hh[1]); pushRing(hh, P.h + 0.3, [0, 1, 1]); }
        }
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
        lg.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
        const lm = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: true }));
        lm.name = 'TileMergedDebugOutline'; group.add(lm);
      }
      tile.footprintStats.push({ index: -1, mode: 'merged-zone', rects: mergedZone.length, deviation: 0, used: true });
    }

    // 4b. Tejados: decisions shared with the procedural city via js/madrid-roofs.js (rules documented
    //    there); the clash test sees same-tile parcels only (bounded approximation, as medianeras).
    {
      const { hips, rings } = matchingPreparation && globalThis.__FP !== false && globalThis.__MERGED !== true && tile.prepared.roofs
        ? tile.prepared.roofs
        : tileRoofInstances(pabs, { footprintEnabled: globalThis.__FP !== false, merged: globalThis.__MERGED === true });
      const dummy = new THREE.Object3D();
      const fill = (geo, list, name) => {
        if (!list.length) return;
        const inst = new THREE.InstancedMesh(geo, hipRoofMat, list.length);
        list.forEach((r, i) => {
          dummy.rotation.set(0, r.rot, 0);
          dummy.position.set(r.x, r.y, r.z);
          const swp = r.swap !== undefined ? r.swap : !!r.rot;
          const eave = r.eave !== undefined ? r.eave : 0.6; // fp strips sit on party walls: no overhang into a taller neighbour
          dummy.scale.set((swp ? r.sd : r.sw) + eave, r.h, (swp ? r.sw : r.sd) + eave);
          dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix);
          inst.setColorAt(i, r.slate ? HIP_SLATE : HIP_PALETTE[r.ci % HIP_PALETTE.length]);
        });
        inst.castShadow = inst.receiveShadow = true;
        inst.name = name;
        group.add(inst);
      };
      const hipGeo = new THREE.BufferGeometry();
      hipGeo.setAttribute('position', new THREE.BufferAttribute(HIP_GEO_TRIS, 3));
      hipGeo.computeVertexNormals();
      fill(hipGeo, hips, 'TileHipRoofs');
      const ringGeo = new THREE.BufferGeometry();
      ringGeo.setAttribute('position', new THREE.BufferAttribute(RING_GEO_TRIS, 3));
      ringGeo.computeVertexNormals();
      fill(ringGeo, rings, 'TileRingRoofs');
    }

    // 5. Landmarks: real footprint extruded to its IDEAM/OSM height. No height = no volume (nothing invented); the
    //    footprint stays covered by its parcel box, so there is no gap to fill.
    for (const [lmName, lm] of Object.entries(tile.landmarks || {})) {
      if (!(lm.h > 0) || !lm.ring || lm.ring.length < 6) continue;
      const ring = toPts(lm.ring);
      if (ring.length < 3) continue;
      if (shoelace(ring) > 0) ring.reverse();
      const lmStyle = MADRID_LANDMARK_STYLES.find(([re]) => re.test(lmName));
      let lmMat = mats.landmark;
      if (lmStyle) {
        if (!mats.landmarkByName.has(lmStyle[0])) {
          mats.landmarkByName.set(lmStyle[0], new THREE.MeshStandardNodeMaterial({
            color: lmStyle[1].color, roughness: lmStyle[1].roughness, metalness: 0.03
          }));
        }
        lmMat = mats.landmarkByName.get(lmStyle[0]);
      }
      const mesh = createExtrudedPolygonMesh(ring, 0, lm.h, lmMat, true, true);
      mesh.name = 'TileLandmark';
      group.add(mesh);
      const bb = bboxOf(ring);
      tileColliders.push({ minX: bb.x0, maxX: bb.x1, minZ: bb.z0, maxZ: bb.z1, minY: 0, maxY: lm.h });
    }

    // 6. Bridge decks: roads that cross the water keep their deck at street level (it is a hole otherwise).
    for (const road of tile.roads || []) {
      const pts = toPts(road[5] || []);
      const w = road[1] || 8;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const inWater = (p) => water.some((r) => pointInRing(r, p.x, p.z));
        if (!(inWater(a) || inWater(b) || inWater({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }))) continue;
        // The deck belongs to the tile whose core holds the segment centre: a span that straddles a seam is drawn once.
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        if (!core.some(([x0, z0, x1, z1]) => mx >= x0 && mx <= x1 && mz >= z0 && mz <= z1)) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        if (len < 1) continue;
        const nx = (-dz / len) * (w / 2 + 1.5), nz = (dx / len) * (w / 2 + 1.5);
        let quad = [
          { x: a.x + nx, z: a.z + nz }, { x: b.x + nx, z: b.z + nz },
          { x: b.x - nx, z: b.z - nz }, { x: a.x - nx, z: a.z - nz }
        ];
        if (shoelace(quad) < 0) quad = quad.reverse();
        const deck = createFlatPolygonMesh(quad, 0.0, mats.road, true);
        deck.name = 'TileBridge';
        group.add(deck);
      }
    }

    const far = matchingPreparation && globalThis.__FP !== false && globalThis.__MERGED !== true && tile.prepared.farBuildings;
    if (far?.indices.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(far.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(far.normals, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(far.colors, 3));
      geometry.setIndex(new THREE.BufferAttribute(far.indices, 1));
      const mesh = new THREE.Mesh(geometry, farBuildingMaterial);
      mesh.name = 'TileFarBuildings';
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.visible = false;
      group.add(mesh);
      group.userData.farGeometry = { nearTriangles: far.nearTriangles, triangles: far.triangles,
        parcels: far.representedParcels, bytes: far.positions.byteLength + far.normals.byteLength + far.colors.byteLength + far.indices.byteLength };
    }
    group.userData.colliders = tileColliders;
    group.userData.parcelKeys = drawnHere;
    group.userData.bytes = tile.bytes || 0;
    group.userData.id = tile.id;
    group.userData.detailBounds = [Math.min(...core.map(r => r[0])), Math.min(...core.map(r => r[1])),
      Math.max(...core.map(r => r[2])), Math.max(...core.map(r => r[3]))];
    if (tile.streetFeatures) {
      group.add(createSourcedStreetTrees(tile.streetFeatures.trees));
      streetFeatures.set(tile.id, tile.streetFeatures);
    }
    scene.add(group);
    if (colliders && tileColliders.length) colliders.push(...tileColliders);
    groups.set(tile.id, { group, colliders: tileColliders });
    tileData.set(tile.id, { id: tile.id, core, blocks: tile.blocks || [], parcels: tile.parcels || [], streetFeatures: tile.streetFeatures || null });
    return groups.get(tile.id);
  }

  function removeTile(id) {
    const entry = groups.get(id);
    if (!entry) return false;
    const { group, colliders: tileColliders } = entry;
    scene.remove(group);
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      // materials are shared between tiles (facades are cached by options): keep them alive
      if (o.isInstancedMesh) o.dispose?.();
    });
    for (const key of group.userData.parcelKeys || []) drawnParcels.delete(key);
    if (colliders && tileColliders.length) {
      const drop = new Set(tileColliders);
      for (let i = colliders.length - 1; i >= 0; i--) if (drop.has(colliders[i])) colliders.splice(i, 1);
    }
    groups.delete(id);
    streetFeatures.delete(id);
    tileData.delete(id);
    return true;
  }

  // Keep one tiny representative of streamed shader variants alive after warm-up.
  // They are hidden after the first frame, retaining renderer caches without
  // mutating MRT state while the user explores or adding recurring draw calls.
  function createCompileProbes() {
    const group = new THREE.Group();
    group.name = 'MadridTileShaderWarmup';
    group.position.set(80000, -1000, 80000);
    for (const material of facades) {
      group.add(createFacadeBoxes(material, [{ x: 0, y: 1, z: 0, w: 1, h: 2, d: 1 }]));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(HIP_GEO_TRIS.slice(), 3));
    geo.computeVertexNormals();
    const roof = new THREE.InstancedMesh(geo, hipRoofMat, 1);
    roof.setMatrixAt(0, new THREE.Matrix4());
    roof.setColorAt(0, HIP_PALETTE[0]);
    group.add(roof);
    group.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), medianeraMat));
    for (const material of hybridFacadeMats) group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
    for (const material of hybridWallMats) group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
    group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    const farProbeGeometry = new THREE.BufferGeometry();
    farProbeGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0], 3));
    farProbeGeometry.setAttribute('normal', new THREE.Float32BufferAttribute([0,0,1, 0,0,1, 0,0,1], 3));
    farProbeGeometry.setAttribute('color', new THREE.Float32BufferAttribute([1,1,1, 1,1,1, 1,1,1], 3));
    const farProbe = new THREE.Mesh(farProbeGeometry, farBuildingMaterial);
    farProbe.castShadow = farProbe.receiveShadow = true;
    farProbe.frustumCulled = false;
    group.add(farProbe);
    scene.add(group);
    return group;
  }

  return {
    addTile,
    facadeMaterials: facades,
    createCompileProbes,
    removeTile,
    has: (id) => groups.has(id),
    ids: () => [...groups.keys()],
    residentStreetFeatures: () => new Map(streetFeatures),
    residentGeometry: () => new Map(tileData),
    residentBytes: () => [...groups.values()].reduce((n, g) => n + (g.group.userData.bytes || 0), 0),
    meshCount: () => [...groups.values()].reduce((n, g) => n + g.group.children.length, 0),
    disposeAll() {
      scene.remove(seedTrees);
      seedTrees.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose?.(); });
      streetFeatures.delete('fase2');
      for (const id of [...groups.keys()]) removeTile(id);
    }
  };
}

export { createOutOfMapFloor };
