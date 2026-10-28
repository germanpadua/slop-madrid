import * as THREE from 'three/webgpu';
import { LANDMARK_SITES } from './city-config.js';
import { MADRID_LANDMARK_STYLES } from './madrid-tiles.js';
import { batchStaticGroupMeshes } from './city-grid.js';

// js/landmarks.js
// Madrid phase: the real OSM landmark footprints (GEO.landmarks) extruded to their tagged heights,
// replacing the hand-modelled NYC landmark set. i3s realistic meshes layer on top (see MADRID.md).

function buildLandmarks(scene) {
  const group = new THREE.Group();
  group.name = 'Landmarks';
  const colliders = [];

  // =========================================================================
  // MADRID: generic extrusion of the real OSM footprints (GEO.landmarks) with IDEAM heights where tagged.
  // The NYC model set (Empire State, Chrysler...) is gone; i3s realistic meshes layer on top later (MADRID.md).
  // =========================================================================
  {
    // Per-name Madrid materials (shared with the tile renderer); warm piedra default, pizarra roofs.
    const DEFAULT_BODY = { color: 0xcfc3ab, roughness: 0.74 };
    const slateMat = new THREE.MeshStandardNodeMaterial({ color: 0x4d4a46, roughness: 0.62, metalness: 0.08 });
    const bodyMats = new Map();
    const matFor = (name) => {
      const hit = MADRID_LANDMARK_STYLES.find(([re]) => re.test(name));
      const spec = hit ? hit[1] : DEFAULT_BODY;
      const key = spec.color + '/' + spec.roughness;
      if (!bodyMats.has(key)) bodyMats.set(key, new THREE.MeshStandardNodeMaterial({ color: spec.color, roughness: spec.roughness, metalness: 0.05 }));
      return bodyMats.get(key);
    };
    for (const [name, lm] of Object.entries(LANDMARK_SITES)) {
      if (!lm.ring || lm.ring.length < 6 || lm.w < 12) continue; // points & slivers stay out (map/teleports still use them)
      // Real height (IDEAM parcel) where known; the 160 m ceiling only guards the extruder — the tallest hit in this
      // box is Torre de Madrid (142 m)
      const H = Math.max(9, Math.min(lm.h || 0, 160) || (lm.w > 80 ? 24 : 14));
      const g = new THREE.Group();
      const n = lm.ring.length / 2;
      const shape = new THREE.Shape();
      shape.moveTo(lm.ring[0] - lm.cx, lm.ring[1] - lm.cz);
      for (let i = 1; i < n; i++) shape.lineTo(lm.ring[i * 2] - lm.cx, lm.ring[i * 2 + 1] - lm.cz);
      shape.closePath();
      const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: false }), matFor(name));
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
