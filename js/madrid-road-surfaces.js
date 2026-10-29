import * as THREE from 'three/webgpu';
import { roadSurfacePositions } from './madrid-road-surface-geometry.js';
export function createMadridRoadSurfaces(roads,core,material) {
  const positions=roadSurfacePositions(roads,core);
  if(!positions.length)return null;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name='MadridRoadSurfaces';mesh.receiveShadow=true;
  return mesh;
}
