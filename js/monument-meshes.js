// Gated mesh-monument loader (LOCAL PROTOTYPE - ?meshmonuments=1 only, default OFF).
// GLBs live in assets/mesh-monuments/ which is gitignored: municipal photogrammetry-derived
// assets stay local until the exact mesh license binding is resolved. Nothing here ships.
// Placement entries are baked at export time (meshproto sidecar -> world x/z).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// name -> { url, x, z, yawDeg }  (x/z: app world coords of the GLB local origin)
const MESH_MONUMENTS = new Map([
  // filled per monument after export sidecar is baked; example:
  // ['Templo de Debod', { url: 'assets/mesh-monuments/debod-d025fp3.glb', x: 0, z: 0, yawDeg: 0 }],
]);

const gateOn = () => new URLSearchParams(location.search).get('meshmonuments') === '1';

export function hasMeshMonument(name) {
  return gateOn() && MESH_MONUMENTS.has(name);
}

// Async load; colliders are pushed synchronously from the landmark footprint by the caller.
export function loadMeshMonuments(scene, landmarks) {
  if (!gateOn() || MESH_MONUMENTS.size === 0) return;
  const byName = landmarks ? new Map(landmarks.map((lm) => [lm.name, lm])) : null;
  const loader = new GLTFLoader();
  for (const [name, cfg] of MESH_MONUMENTS) {
    if (byName && !byName.has(name)) continue;
    loader.load(cfg.url, (gltf) => {
      const root = gltf.scene;
      root.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          if (o.material) { o.material.metalness = 0; o.material.roughness = 0.95; }
        }
      });
      root.position.set(cfg.x, 0, cfg.z);
      if (cfg.yawDeg) root.rotation.y = (cfg.yawDeg * Math.PI) / 180;
      scene.add(root);
    }, undefined, (err) => console.warn('mesh monument load failed', name, err));
  }
}
