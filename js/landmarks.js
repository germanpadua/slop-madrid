import * as THREE from 'three/webgpu';
import { LANDMARK_SITES } from './city-config.js';
import { MADRID_LANDMARK_STYLES } from './madrid-tiles.js';
import { buildProceduralMonument, buildProceduralColliders } from './monuments.js';
import { batchStaticGroupMeshes } from './city-grid.js';
import {
  Fn,
  float,
  vec2,
  color,
  uv,
  positionWorld,
  normalWorldGeometry,
  abs,
  fract,
  floor,
  step,
  smoothstep,
  fwidth,
  mix,
  sin,
  dot
} from 'three/tsl';

// js/landmarks.js
// Madrid phase: the real OSM landmark footprints (GEO.landmarks) extruded to their tagged heights,
// replacing the hand-modelled NYC landmark set. i3s realistic meshes layer on top (see MADRID.md).

// Warm piedra default for landmarks without a named style (kept in sync with MADRID_LANDMARK_STYLES).
const DEFAULT_LANDMARK_BODY = { color: 0xcfc3ab, roughness: 0.74 };

// One stone tint per named landmark style, in a fixed order. The facade shader selects it from the
// fragment's UV.x so every generic body can share a single material (and still keep its own tone).
const LANDMARK_TINTS = [DEFAULT_LANDMARK_BODY.color, ...MADRID_LANDMARK_STYLES.map(([, spec]) => spec.color)]
  .filter((tint, i, all) => all.indexOf(tint) === i);
const LANDMARK_TINT_INDEX = new Map(LANDMARK_TINTS.map((tint, i) => [tint, i]));

/**
 * One shared facade material for the generic OSM-footprint landmark bodies. The window grid, string
 * courses and plinth are derived from the fragment's world position (x or z along the dominant wall
 * axis, y for storeys), so batchStaticGroupMeshes() can still merge every body into a single draw.
 *
 * Per-landmark data rides in the geometry UVs, which are the only extra attribute batching keeps:
 * uv.x = stone tint index + 0.5 (floor() recovers the style) and uv.y = body height in metres, used
 * to end the window rows in a solid parapet instead of a sliced top row. One material and one shader
 * compile cover all landmarks; no image textures and no per-building materials.
 */
function createLandmarkFacadeMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0.03 });
  mat.name = 'LandmarkFacade';
  const cGlass = color(0x1a2329);
  const cGlassWarm = color(0x33424a);
  const cTrim = color(0xefe7d6);
  const BAY = 2.7; // m: grand civic bays (~1.6 m opening)
  const STOREY = 3.55; // m: Madrid floor-to-floor

  mat.colorNode = Fn(() => {
    const uv0 = uv();
    const tintIdx = floor(uv0.x);
    let stone = color(LANDMARK_TINTS[0]);
    for (let i = 1; i < LANDMARK_TINTS.length; i++) {
      stone = mix(stone, color(LANDMARK_TINTS[i]), step(i - 0.5, tintIdx));
    }

    const p = positionWorld;
    const n = abs(normalWorldGeometry);
    const wall = float(1.0).sub(step(0.75, n.y)); // vertical faces only; the roof cap keeps stone
    // Window bays run along whichever horizontal world axis the wall faces. Extrusion walls are flat,
    // so the choice is constant per face (the same convention facadeCell() uses for world-space walls).
    const alongZ = step(n.z, n.x);
    const u = mix(p.x, p.z, alongZ);
    const gu = u.div(BAY);
    const gv = p.y.div(STOREY);
    const cu = fract(gu);
    const cv = fract(gv);
    const aaU = fwidth(gu).max(0.001).mul(0.75);
    const aaV = fwidth(gv).max(0.001).mul(0.75);

    // Punched window opening [0.22, 0.78] x [0.32, 0.84] of its bay, with a stone frame (8-10 cm)
    // and a sill. The fwidth ramps are the anti-aliasing: grids settle to their mean coverage when a
    // bay shrinks below a pixel, so distant landmarks do not shimmer as the camera moves.
    const inX = smoothstep(float(0.22).sub(aaU), float(0.22).add(aaU), cu)
      .mul(smoothstep(float(0.78).add(aaU), float(0.78).sub(aaU), cu));
    const inY = smoothstep(float(0.32).sub(aaV), float(0.32).add(aaV), cv)
      .mul(smoothstep(float(0.84).add(aaV), float(0.84).sub(aaV), cv));
    const glassX = smoothstep(float(0.255).sub(aaU), float(0.255).add(aaU), cu)
      .mul(smoothstep(float(0.745).add(aaU), float(0.745).sub(aaU), cu));
    const glassY = smoothstep(float(0.355).sub(aaV), float(0.355).add(aaV), cv)
      .mul(smoothstep(float(0.805).add(aaV), float(0.805).sub(aaV), cv));

    // Solid parapet in the last 0.75 m: the body height comes from uv.y, so a landmark whose height is
    // not a whole number of storeys never ends in a sliced window row.
    const fromTop = uv0.y.sub(p.y);
    const topSolid = smoothstep(0.15, 0.75, fromTop);
    const opening = inX.mul(inY).mul(wall).mul(topSolid);
    const glass = glassX.mul(glassY).mul(wall).mul(topSolid);
    const frame = opening.sub(glass).max(0.0);
    const sill = inX.mul(smoothstep(0.245, 0.26, cv)).mul(smoothstep(0.315, 0.30, cv)).mul(wall).mul(topSolid);

    // Storey joints: a thin recessed line every floor, a stronger string course every 4 floors and a
    // granite plinth on the ground floor (flat Madrid palette, no image textures).
    const floorLine = smoothstep(0.055, 0.0, cv).mul(wall);
    const belt = smoothstep(0.035, 0.0, fract(gv.div(4.0))).mul(wall);
    const zocalo = float(1.0).sub(smoothstep(1.1, 1.7, p.y));
    const plinth = mix(float(1.0), float(0.74), zocalo);
    const rnd = fract(sin(dot(vec2(floor(gu), floor(gv)), vec2(12.9898, 78.233))).mul(43758.5453));
    const glassCol = mix(cGlass, cGlassWarm, rnd.mul(0.55));
    const trim = mix(stone, cTrim, 0.45);

    let col = stone.mul(plinth)
      .mul(float(1.0).sub(floorLine.mul(0.32)))
      .mul(float(1.0).sub(belt.mul(0.28)));
    col = mix(col, trim, frame);
    col = mix(col, trim, sill.mul(0.9));
    col = mix(col, glassCol, glass);
    const cornice = smoothstep(0.55, 0.70, fromTop).mul(smoothstep(1.10, 0.90, fromTop)).mul(wall);
    col = mix(col, trim, cornice);
    return col;
  })();

  return mat;
}

function buildLandmarks(scene) {
  const group = new THREE.Group();
  group.name = 'Landmarks';
  const colliders = [];

  // =========================================================================
  // MADRID: generic extrusion of the real OSM footprints (GEO.landmarks) with IDEAM heights where tagged.
  // The NYC model set (Empire State, Chrysler...) is gone; i3s realistic meshes layer on top later (MADRID.md).
  // =========================================================================
  {
    const slateMat = new THREE.MeshStandardNodeMaterial({ color: 0x4d4a46, roughness: 0.62, metalness: 0.08 });
    // Open spaces (plazas, glorietas, parks) are NOT buildings: OSM maps their pedestrian area,
    // and extruding it buries real monuments (Plaza de la Independencia covered Puerta de Alcalá
    // with a 24 m slab). Render them as flat warm-granite pavement instead; no collider, walkable.
    const OPEN_SPACE = /^(Plaza|Glorieta|Parque|Jardín|Jardines|Paseo|Campo|Cuesta)\b|^Puerta del Sol\b/i;
    // Fountains are tagged as OSM areas too, but they are not buildings: extruding the Fuente de
    // Cibeles footprint to its 8 m sculpture height produced the blank white "cube" on the roundabout.
    // Lay its footprint as pavement without a raised collider instead of giving a fountain
    // a facade. Temples/statues with a ring keep the plain stone body: they are monuments, not blocks.
    const FLAT_FEATURE = /^Fuente\b/i;
    const NON_BUILDING = /^(Templo|Monumento|Estatua)\b/i;
    const plazaMat = new THREE.MeshStandardNodeMaterial({ color: 0xbfb49f, roughness: 0.9, metalness: 0.02 });
    const facadeMat = createLandmarkFacadeMaterial();
    const bodyMats = new Map();
    const styleFor = (name) => {
      const hit = MADRID_LANDMARK_STYLES.find(([re]) => re.test(name));
      return hit ? hit[1] : DEFAULT_LANDMARK_BODY;
    };
    const matFor = (name) => {
      const spec = styleFor(name);
      const key = spec.color + '/' + spec.roughness;
      if (!bodyMats.has(key)) bodyMats.set(key, new THREE.MeshStandardNodeMaterial({ color: spec.color, roughness: spec.roughness, metalness: 0.05 }));
      return bodyMats.get(key);
    };
    for (const [name, lm] of Object.entries(LANDMARK_SITES)) {
      if (!lm.ring || lm.ring.length < 6 || lm.w < 12) continue; // points & slivers stay out (map/teleports still use them)
      // The legacy Cibeles rectangle is a union of named ROAD bounds, not a pedestrian area.
      // Keep the location for maps/teleports; only explicit surface provenance may restore paving.
      // Source audit: docs/validation/2026-10-29-cibeles-plaza/.
      if (lm.renderSurface === false || (name === 'Plaza de la Cibeles' &&
          lm.renderSurface !== true && !lm.building && lm.ring.length === 8)) continue;
      // Real height (IDEAM parcel) where known; the 160 m ceiling only guards the extruder — the tallest hit in this
      // box is Torre de Madrid (142 m)
      const H = Math.max(9, Math.min(lm.h || 0, 160) || (lm.w > 80 ? 24 : 14));
      const g = new THREE.Group();
      if (OPEN_SPACE.test(name) || FLAT_FEATURE.test(name)) {
        const n = lm.ring.length / 2;
        const shape = new THREE.Shape();
        shape.moveTo(lm.ring[0] - lm.cx, -(lm.ring[1] - lm.cz));
        for (let i = 1; i < n; i++) shape.lineTo(lm.ring[i * 2] - lm.cx, -(lm.ring[i * 2 + 1] - lm.cz));
        shape.closePath();
        const flat = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, 0.12, 0), plazaMat);
        flat.receiveShadow = true;
        g.add(flat);
        g.position.set(lm.cx, 0, lm.cz);
        group.add(g);
        // Flat surfaces have no raised body for the player to collide with.
        continue;
      }
      // Procedural recognizable monuments replace the flat extrusion where modelled
      const proc = buildProceduralMonument(name, matFor(name), lm);
      if (proc) {
        g.add(proc);
        g.position.set(lm.cx, 0, lm.cz);
        group.add(g);
        const pc = buildProceduralColliders(name, lm);
        if (pc) colliders.push(...pc);
        else colliders.push({ minX: lm.cx - lm.w / 2, maxX: lm.cx + lm.w / 2, minZ: lm.cz - lm.d / 2, maxZ: lm.cz + lm.d / 2, maxY: H });
        continue;
      }
      const n = lm.ring.length / 2;
      const shape = new THREE.Shape();
      shape.moveTo(lm.ring[0] - lm.cx, -(lm.ring[1] - lm.cz));
      for (let i = 1; i < n; i++) shape.lineTo(lm.ring[i * 2] - lm.cx, -(lm.ring[i * 2 + 1] - lm.cz));
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: false });
      // Buildings share the one facade material; the stone tint and body height travel in the UVs that
      // batching preserves. Monuments/temples keep the plain body (their own detail is not facade work).
      const bodyMat = NON_BUILDING.test(name) ? matFor(name) : facadeMat;
      if (bodyMat === facadeMat) {
        const tint = LANDMARK_TINT_INDEX.get(styleFor(name).color) ?? 0;
        const uvAttr = geo.attributes.uv;
        for (let i = 0; i < uvAttr.count; i++) uvAttr.setXY(i, tint + 0.5, H);
      }
      const body = new THREE.Mesh(geo, bodyMat);
      body.rotation.x = -Math.PI / 2; // extrude runs along +z; rotate the footprint to the ground plane
      body.castShadow = true;
      body.receiveShadow = true;
      g.add(body);
      const roof = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, H, 0), slateMat);
      g.add(roof);
      g.position.set(lm.cx, 0, lm.cz);
      group.add(g);
      colliders.push({ minX: lm.cx - lm.w / 2, maxX: lm.cx + lm.w / 2, minZ: lm.cz - lm.d / 2, maxZ: lm.cz + lm.d / 2, maxY: H });
    }
  }

  batchStaticGroupMeshes(group);

  scene.add(group);
  return { group, colliders };
}

let bryantParkLawn; // NYC-only: never set in Madrid; consumers fall back

export { buildLandmarks, bryantParkLawn };
