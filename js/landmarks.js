import * as THREE from 'three/webgpu';
import { LANDMARK_SITES } from './city-config.js';
import { MADRID_LANDMARK_STYLES } from './madrid-tiles.js';
import { buildProceduralMonument, buildProceduralColliders, buildSourcedLandmarkBody } from './monuments.js';
import { batchStaticGroupMeshes } from './city-grid.js';
import {
  Fn,
  float,
  vec2,
  color,
  uv,
  positionWorld,
  normalLocal,
  modelNormalMatrix,
  normalize,
  varying,
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
 * uv.x = stone tint index + storey spacing / 20 (floor() recovers the style); uv.y = body height, used
 * to end the window rows in a solid parapet instead of a sliced top row. One material and one shader
 * compile cover all landmarks; no image textures and no per-building materials.
 */
// Compute the projection in the vertex stage: view-space normal round-trips can
// flip the selected axis on diagonal walls when the camera moves.
const landmarkNormalVertex = normalize(modelNormalMatrix.mul(normalLocal));
const landmarkWorldNormal = varying(landmarkNormalVertex, 'vLandmarkWorldNormal');
const landmarkAlongZ = varying(
  step(abs(landmarkNormalVertex.z).sub(0.0001), abs(landmarkNormalVertex.x)),
  'vLandmarkAlongZ'
).setInterpolation(THREE.InterpolationSamplingType.FLAT, THREE.InterpolationSamplingMode.EITHER);

function createLandmarkFacadeMaterial() {
  const mat=new THREE.MeshStandardNodeMaterial({roughness:1,metalness:0,flatShading:true});
  mat.name='LandmarkFacade';
  mat.colorNode=Fn(()=>{
    const data=uv(),tint=floor(data.x);
    let stone=color(LANDMARK_TINTS[0]);
    for(let i=1;i<LANDMARK_TINTS.length;i++) stone=mix(stone,color(LANDMARK_TINTS[i]),step(i-0.5,tint));
    const n=abs(landmarkWorldNormal),p=positionWorld;
    const u=mix(p.x,p.z,landmarkAlongZ).div(3.6);
    const v=p.y.div(fract(data.x).mul(20).clamp(2.5,8));
    const au=fwidth(u).max(0.001),av=fwidth(v).max(0.001);
    const x=smoothstep(float(0.25).sub(au),float(0.25).add(au),fract(u))
      .mul(float(1).sub(smoothstep(float(0.75).sub(au),float(0.75).add(au),fract(u))));
    const y=smoothstep(float(0.30).sub(av),float(0.30).add(av),fract(v))
      .mul(float(1).sub(smoothstep(float(0.82).sub(av),float(0.82).add(av),fract(v))));
    const wall=float(1).sub(step(0.75,n.y));
    const opening=x.mul(y).mul(wall).mul(step(0.8,data.y.sub(p.y)));
    return mix(stone,color(0x35454b),opening);
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
    // Canonical aliases (for example Estación de Príncipe Pío) share the same
    // source ring as their OSM name. Rendering both creates coplanar duplicate meshes.
    const aliasOriginals=new Set(Object.values(LANDMARK_SITES).filter(lm=>lm.osmName &&
      LANDMARK_SITES[lm.osmName] && JSON.stringify(lm.ring)===JSON.stringify(LANDMARK_SITES[lm.osmName].ring)).map(lm=>lm.osmName));
    for (const [name, lm] of Object.entries(LANDMARK_SITES)) {
      if(aliasOriginals.has(name)) continue;
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
      if (name === 'Fuente de Cibeles') {
        const fountain=buildProceduralMonument(name,matFor(name),lm);
        if(fountain) {g.add(fountain);g.position.set(lm.cx,0,lm.cz);group.add(g);continue;}
      }
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
      // Use clipped source volumes where available; the former hull erased patios and tiers.
      facadeMat.userData.landmarkTint = LANDMARK_TINT_INDEX.get(styleFor(name).color) ?? 0;
      const sourced=buildSourcedLandmarkBody(name,lm,facadeMat);
      if(sourced) {
        g.add(sourced); g.position.set(lm.cx,0,lm.cz); group.add(g);
        colliders.push({minX:lm.cx-lm.w/2,maxX:lm.cx+lm.w/2,minZ:lm.cz-lm.d/2,maxZ:lm.cz+lm.d/2,maxY:H});
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
        for (let i = 0; i < uvAttr.count; i++) uvAttr.setXY(i, tint + 3.55 / 20, H);
      }
      const body = new THREE.Mesh(geo, bodyMat);
      body.rotation.x = -Math.PI / 2; // extrude runs along +z; rotate the footprint to the ground plane
      body.castShadow = true;
      body.receiveShadow = true;
      g.add(body);
      const roof = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, H + 0.03, 0), slateMat);
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
