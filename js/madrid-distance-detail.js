import * as THREE from 'three/webgpu';
import { MADRID_FACADE_OPTS } from './madrid-tiles.js';

// Distant masonry keeps the original footprint/height/roof geometry, but omits
// subpixel windows, interiors and balcony shading. Monuments are never registered.
export function createMadridDistanceDetail(nearMaterials, { geometry = false } = {}) {
  const farMaterials = MADRID_FACADE_OPTS.map(o => new THREE.MeshStandardNodeMaterial({
    color: o.stoneColor, roughness: 0.95, metalness: 0
  }));
  const materialIndex = new Map(nearMaterials.map((m, i) => [m, i]));
  const entries = new Map();
  let changes = 0;
  let enabled = true;
  return {
    setEnabled(value) { enabled = Boolean(value); },
    register(scene) {
      scene.traverse(root => {
        if (root.name !== 'ManhattanCityBlocks' && !root.name.startsWith('MadridTile:')) return;
        if (geometry) {
          const far = root.children?.find(mesh => mesh.name === 'TileFarBuildings');
          if (!far || entries.has(root)) return;
          // The seed centre names its massing meshes Centre*: hide exactly what the proxy replaces
          // (buildings, rear yards, cornices) and keep hip roofs, water towers, signs and lights.
          const isCentre = root.name === 'ManhattanCityBlocks';
          entries.set(root, { root, bounds: root.userData.detailBounds, distant: false, geometry: true, far,
            near: isCentre
              ? root.children.filter(mesh => /^Centre(Buildings|Yards|Cornices)$/.test(mesh.name))
              : root.children.filter(mesh => /^TileBuildings/.test(mesh.name)) });
          return;
        }
        root.traverse(mesh => {
          if (!mesh.isMesh || entries.has(mesh) || !materialIndex.has(mesh.material)) return;
          const tileBounds = root.userData.detailBounds;
          const sphere = mesh.boundingSphere;
          if (!tileBounds && !sphere) return;
          const bounds = tileBounds || [sphere.center.x - sphere.radius, sphere.center.z - sphere.radius,
            sphere.center.x + sphere.radius, sphere.center.z + sphere.radius];
          entries.set(mesh, { root, bounds, original: mesh.material, far: farMaterials[materialIndex.get(mesh.material)], distant: false });
          mesh.userData.madridDetailedMaterial = mesh.material;
        });
      });
    },
    update(position) {
      for (const [mesh, e] of entries) {
        if (!e.root.parent) { entries.delete(mesh); continue; }
        const [x0, z0, x1, z1] = e.bounds;
        const distance = Math.hypot(Math.max(x0 - position.x, 0, position.x - x1), position.y,
          Math.max(z0 - position.z, 0, position.z - z1));
        const distant = enabled && (e.distant ? distance > 850 : distance > 1000);
        if (distant !== e.distant) {
          if (e.geometry) {
            e.far.visible = distant;
            for (const near of e.near) near.visible = !distant;
          } else mesh.material = distant ? e.far : e.original;
          mesh.userData.madridFarDetail = distant;
          e.distant = distant;
          changes++;
        }
      }
    },
    status() {
      return { enabled, mode: geometry ? 'geometry' : 'material', near: [...entries.values()].filter(e => !e.distant).length,
        far: [...entries.values()].filter(e => e.distant).length, changes };
    },
    createCompileProbes() {
      const group = new THREE.Group();
      if (geometry) return group;
      for (const material of farMaterials) {
        const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, 1);
        mesh.setMatrixAt(0, new THREE.Matrix4());
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        group.add(mesh);
      }
      return group;
    }
  };
}
