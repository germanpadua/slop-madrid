import * as THREE from 'three/webgpu';

// Source points only. Crown/trunk shapes are illustrative low-poly symbols, not
// surveyed botanical meshes. Missing dimensions use a documented 7 m / 4.4 m glyph.
const bark = new THREE.MeshStandardNodeMaterial({ color: 0x75604b, roughness: 1 });
const leaves = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
const greens = [0x64824e, 0x78945b, 0x516f49, 0x8a9c62].map(c => new THREE.Color(c));
const metres = value => {
  const match = String(value ?? '').trim().match(/^(\d+(?:[.,]\d+)?)\s*(?:m)?$/);
  return match ? Number(match[1].replace(',', '.')) : NaN;
};
export function createSourcedStreetTrees(points = []) {
  const group = new THREE.Group();
  group.name = 'MadridSourcedStreetTrees';
  group.userData.sourceCount = points.length;
  if (!points.length) return group;
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.20, 1, 5), bark, points.length);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), leaves, points.length);
  const transform = new THREE.Object3D();
  for (const [i, point] of points.entries()) {
    const taggedHeight = metres(point.tags?.height);
    const taggedDiameter = metres(point.tags?.diameter_crown);
    const height = taggedHeight > 1 && taggedHeight < 60 ? taggedHeight : 7;
    const radius = taggedDiameter > 0 && taggedDiameter < 40 ? taggedDiameter / 2 : Math.min(2.2, height * 0.32);
    const trunkHeight = height * 0.52;
    transform.position.set(point.x, trunkHeight / 2 + 0.18, point.z);
    transform.scale.set(1, trunkHeight, 1);
    transform.updateMatrix(); trunk.setMatrixAt(i, transform.matrix);
    transform.position.y = height * 0.70 + 0.18;
    transform.rotation.y = (point.id % 628) / 100;
    transform.scale.set(radius, height * 0.30, radius);
    transform.updateMatrix(); crown.setMatrixAt(i, transform.matrix);
    crown.setColorAt(i, greens[point.id % greens.length]);
    transform.rotation.y = 0;
  }
  for (const mesh of [trunk, crown]) {
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}
