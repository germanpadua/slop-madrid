import * as THREE from 'three/webgpu';
import { LANDMARK_SITES } from './city-config.js';
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
    const stoneMat = new THREE.MeshStandardNodeMaterial({ color: 0xbfae94, roughness: 0.74, metalness: 0.05 });
    const slateMat = new THREE.MeshStandardNodeMaterial({ color: 0x4d4a46, roughness: 0.62, metalness: 0.08 });
    const GOLD = { 'Palacio de Cibeles': 1, 'Banco de España': 1, 'Palacio del Congreso de los Diputados': 1, 'Teatro Real': 1, 'Casa de la Panadería': 1, 'Palacio de Linares': 1, 'Círculo de Bellas Artes': 1 };
    for (const [name, lm] of Object.entries(LANDMARK_SITES)) {
      if (!lm.ring || lm.ring.length < 6 || lm.w < 12) continue; // points & slivers stay out (map/teleports still use them)
      const H = Math.max(9, Math.min(lm.h || 0, 45) || (lm.w > 80 ? 24 : 14));
      const g = new THREE.Group();
      const n = lm.ring.length / 2;
      const shape = new THREE.Shape();
      shape.moveTo(lm.ring[0] - lm.cx, lm.ring[1] - lm.cz);
      for (let i = 1; i < n; i++) shape.lineTo(lm.ring[i * 2] - lm.cx, lm.ring[i * 2 + 1] - lm.cz);
      shape.closePath();
      const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: false }), GOLD[name] ? stoneMat : slateMat);
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
