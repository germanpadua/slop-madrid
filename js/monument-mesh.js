// js/monument-mesh.js — turns a generated monument module (js/monumentos/m-<id>.js) into scene geometry.
//
// The module carries quantised positions (int16 decimetres, x east / y up / z south, local to `origin`), interleaved
// vertex colours (uint8 RGB) and an index buffer. Every monument was flattened per source building by the pipeline,
// so its lowest vertex is exactly on the simulation ground: the group is placed at (origin.x, 0, origin.z).
import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';

const bytesOf = (b64) => {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

/**
 * @param {object} data MONUMENT export of js/monumentos/m-<id>.js
 * @returns {{group: THREE.Group, mesh: THREE.Mesh, colliders: object[], bytes: number}}
 */
export function buildMonumentMesh(data) {
  const q = new Int16Array(bytesOf(data.positions).buffer);
  const rgb = bytesOf(data.colors);
  const index = data.indexBits === 32
    ? new Uint32Array(bytesOf(data.indices).buffer)
    : new Uint16Array(bytesOf(data.indices).buffer);
  const count = q.length / 3;
  const quantum = data.quantum || 0.1;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = q[i * 3] * quantum;
    positions[i * 3 + 1] = q[i * 3 + 1] * quantum;
    positions[i * 3 + 2] = q[i * 3 + 2] * quantum;
    colors[i * 3] = rgb[i * 3] / 255;
    colors[i * 3 + 1] = rgb[i * 3 + 1] / 255;
    colors[i * 3 + 2] = rgb[i * 3 + 2] / 255;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeVertexNormals(); // flatShading decides the look; smooth normals are the fallback
  geometry.computeBoundingSphere();

  // Flat shading keeps the simplified facets honest and avoids smoothing artefacts across facade edges.
  const material = new THREE.MeshStandardNodeMaterial({
    roughness: 0.9,
    metalness: 0.02,
    flatShading: true
  });
  material.colorNode = attribute('color', 'vec3');

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `MonumentMesh:${data.id}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.name = `Monument:${data.id}`;
  group.position.set(data.origin[0], 0.03, data.origin[2]);
  group.add(mesh);
  group.userData.monument = data.id;

  const bounds = data.bounds;
  const colliders = [{
    minX: Math.min(bounds[0], bounds[2]),
    maxX: Math.max(bounds[0], bounds[2]),
    minZ: Math.min(bounds[1], bounds[3]),
    maxZ: Math.max(bounds[1], bounds[3]),
    minY: 0,
    maxY: Math.max(2, data.height || 10)
  }];

  return { group, mesh, colliders, bytes: data.bytes || 0 };
}
