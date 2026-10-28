// js/madrid-tile-world.js — phase-3 tile renderer: turns a generated tile module (js/geodata/tile-<id>.js, see
// tools/madrid/build.mjs + tools/madrid/tiles.mjs) into scene geometry, and takes it out again on eviction.
//
// The seed tile (phase 2) keeps the full procedural city of js/madrid-geodata.js. Tiles are rendered at the same
// 1:1 frame with the same facades, paving and water, one level of detail below the seed: every IDEAM parcel becomes
// one facade box of its real height inside its real block slab (the seed masses a block into tiers/steps from the
// same parcels). Everything here is real geometry owned by the tile core; polygons crossing a seam were already
// clipped by the builder, so adjacent tiles never draw the same surface twice.
import * as THREE from 'three/webgpu';
import { Fn, abs, color, fract, max, mix, positionWorld, smoothstep } from 'three/tsl';
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
import { MADRID_FACADE_OPTS, MADRID_LANDMARK_STYLES } from './madrid-tiles.js';

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

export function createTileWorld(scene, { colliders = null, materials = null } = {}) {
  // Shared materials: the facades come from the seed's own table (cached by options, so one shader compile each).
  // Madrid almendra palettes (caliza / ladrillo visto / revoco encalado, balcones rhythm) - NOT the
  // Manhattan pre-war table. Same factories, Madrid options; faces keep the storefront ground floors (comercios
  // en bajos) until road-adjacency data picks entry vs shop per wall.
  const facades = FACADE_DEFS.slice(0, 3).map(([create], i) => create({ ...MADRID_FACADE_OPTS[i % MADRID_FACADE_OPTS.length], boxLocal: true, madrid: true }));
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
  const groups = new Map(); // tile id -> { group, colliders }
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
      pabs.push({ x0: bb.x0, x1: bb.x1, z0: bb.z0, z1: bb.z1, w, d, h: parcel.h, index });
      tileColliders.push({ minX: bb.x0, maxX: bb.x1, minZ: bb.z0, maxZ: bb.z1, minY: 0, maxY: parcel.h });
    }
    const MED_TOL = 1.5, MED_OV = 0.3;
    const medianeraHeights = (P) => {
      const out = [0, 0, 0, 0]; // max abutting-neighbor height on -x, +x, -z, +z; 0 = free side
      for (const Q of pabs) {
        if (Q === P) continue;
        const oz = Math.min(P.z1, Q.z1) - Math.max(P.z0, Q.z0);
        const ox = Math.min(P.x1, Q.x1) - Math.max(P.x0, Q.x0);
        if (Math.abs(Q.x1 - P.x0) < MED_TOL && oz > MED_OV * P.d) out[0] = Math.max(out[0], Q.h);
        if (Math.abs(Q.x0 - P.x1) < MED_TOL && oz > MED_OV * P.d) out[1] = Math.max(out[1], Q.h);
        if (Math.abs(Q.z1 - P.z0) < MED_TOL && ox > MED_OV * P.w) out[2] = Math.max(out[2], Q.h);
        if (Math.abs(Q.z0 - P.z1) < MED_TOL && ox > MED_OV * P.w) out[3] = Math.max(out[3], Q.h);
      }
      return out;
    };
    for (const P of pabs) {
      const cx = (P.x0 + P.x1) / 2, cz = (P.z0 + P.z1) / 2;
      const tier = Math.floor(hash(cx, cz, P.index) * facades.length) % facades.length;
      const tone = hash(cz, cx, 3);
      const shop = WALL_KINDS.shop;
      const nH = medianeraHeights(P);
      const exposed = nH.map((n) => n >= 1 && P.h - n >= 2.5);
      if (!exposed.some(Boolean)) {
        items[tier].push({ x: cx, y: P.h / 2, z: cz, w: P.w, h: P.h, d: P.d, tone, faces: [shop, shop, shop, shop] });
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

    group.userData.colliders = tileColliders;
    group.userData.parcelKeys = drawnHere;
    group.userData.bytes = tile.bytes || 0;
    group.userData.id = tile.id;
    scene.add(group);
    if (colliders && tileColliders.length) colliders.push(...tileColliders);
    groups.set(tile.id, { group, colliders: tileColliders });
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
    return true;
  }

  return {
    addTile,
    removeTile,
    has: (id) => groups.has(id),
    ids: () => [...groups.keys()],
    residentBytes: () => [...groups.values()].reduce((n, g) => n + (g.group.userData.bytes || 0), 0),
    meshCount: () => [...groups.values()].reduce((n, g) => n + g.group.children.length, 0),
    disposeAll() {
      for (const id of [...groups.keys()]) removeTile(id);
    }
  };
}

export { createOutOfMapFloor };
