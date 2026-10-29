import * as THREE from 'three/webgpu';
import { color, mix, smoothstep } from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';

// Positions come exclusively from OSM nodes. Documented low-poly symbols, not surveyed species/fixture designs:
// untagged trees 7 m, lamps 6 m, signal posts 3 m. No invented park scatter or signal phasing.
export function buildMadridStreetPoints(points) {
  const group = new THREE.Group();
  group.name = 'MadridSourcedStreetPoints';
  const wood = new THREE.MeshStandardNodeMaterial({ color: 0x655345, roughness: 1 });
  const leaf = new THREE.MeshStandardNodeMaterial({ color: 0x648356, roughness: 1, flatShading: true });
  const iron = new THREE.MeshStandardNodeMaterial({ color: 0x44494a, roughness: 0.8 });
  const glow = new THREE.MeshBasicNodeMaterial();
  glow.colorNode = mix(color(0x94968f), color(0xffe4ba).mul(1.6), smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow));
  const bins = [[], [], [], []];
  for (const p of points) {
    const tree = p.kind === 'tree', lamp = p.kind === 'street_lamp';
    const h = Math.max(1, p.h || (tree ? 7 : lamp ? 6 : 3));
    bins[tree ? 0 : 2].push({ x: p.x, z: p.z, y: h * 0.5, sx: tree ? 0.22 : 0.09, sy: h, sz: tree ? 0.22 : 0.09 });
    if (tree) bins[1].push({ x: p.x, z: p.z, y: h * 0.75, sx: h * 0.32, sy: h * 0.37, sz: h * 0.32 });
    if (lamp) bins[3].push({ x: p.x, z: p.z, y: h, sx: 0.36, sy: 0.16, sz: 0.36 });
    // Source markers only, unlit: the node tag supplies no direction or signal phase.
    if (!tree && !lamp) bins[2].push({ x: p.x, z: p.z, y: h - 0.3, sx: 0.3, sy: 0.65, sz: 0.22 });
  }
  const specs = [[new THREE.CylinderGeometry(1, 1, 1, 5), wood], [new THREE.IcosahedronGeometry(1, 0), leaf],
    [new THREE.BoxGeometry(1, 1, 1), iron], [new THREE.IcosahedronGeometry(1, 0), glow]];
  const matrix = new THREE.Matrix4();
  bins.forEach((items, i) => {
    const [geo, mat] = specs[i];
    if (!items.length) { geo.dispose(); mat.dispose(); return; }
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((p, n) => mesh.setMatrixAt(n, matrix.makeScale(p.sx, p.sy, p.sz).setPosition(p.x, p.y, p.z)));
    mesh.castShadow = i !== 3; mesh.receiveShadow = true;
    mesh.userData.tileOwnedMaterial = true;
    mesh.name = ['SourcedTreeTrunks', 'SourcedTreeCrowns', 'SourcedLampAndSignalPosts', 'SourcedLampGlow'][i];
    group.add(mesh);
  });
  group.userData.sourcePoints = points.length;
  return group;
}
