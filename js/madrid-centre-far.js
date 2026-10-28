import * as THREE from 'three/webgpu';
import { buildFarBuildings } from './madrid-far-buildings.js';
import { partyWallHeights } from './madrid-adjacency.js';

// Geometric far proxy for the seed centre (fase2): the same union-of-OBBs far treatment the
// streamed tiles receive from the worker, built here from the phase-2 cadastral parcels
// (GEO.parcels: per block, {ring, h}; no holes in this dataset). Experiment only - main.js wires
// it solely under ?detail=geometry. Monuments/landmarks live in separate roots and stay detailed.
export function createCentreFarBuildings(GEO) {
  const parcels = [];
  for (const arr of GEO.parcels || []) {
    for (const p of arr) {
      if (!p.ring || p.ring.length < 6 || !(p.h > 0)) continue;
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let i = 0; i + 1 < p.ring.length; i += 2) {
        x0 = Math.min(x0, p.ring[i]); x1 = Math.max(x1, p.ring[i]);
        z0 = Math.min(z0, p.ring[i + 1]); z1 = Math.max(z1, p.ring[i + 1]);
      }
      parcels.push({ x0, x1, z0, z1, h: p.h, ring: p.ring, holes: null, fp: null, index: parcels.length });
    }
  }
  if (!parcels.length) return null;
  const heights = partyWallHeights(parcels);
  const far = buildFarBuildings(parcels, heights);
  if (!far.indices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(far.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(far.normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(far.colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(far.indices, 1));
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'TileFarBuildings';
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.visible = false; // distance-detail flips it past the hysteresis band
  // GEO.manhattan is a ring (x,z pairs), NOT a bbox - derive the box or the hysteresis band degenerates.
  const xs = [], zs = [];
  for (let i = 0; i + 1 < GEO.manhattan.length; i += 2) { xs.push(GEO.manhattan[i]); zs.push(GEO.manhattan[i + 1]); }
  return {
    mesh,
    bounds: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)],
    stats: {
      parcels: parcels.length,
      triangles: far.triangles,
      nearTriangles: far.nearTriangles,
      bytes: far.positions.byteLength + far.normals.byteLength + far.colors.byteLength + far.indices.byteLength
    }
  };
}
