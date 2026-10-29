import * as THREE from 'three/webgpu';

// Compact extrusion of a sourced footprint: indexed roof + four vertices per wall, no buried bottom cap.
// ExtrudeGeometry's non-indexed bevel-cap machinery is unnecessary for these flat, street-level parcels.
export function createParcelGeometry(flat, height, holes = []) {
  const readRing = (flat) => {
    const ring = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const p = new THREE.Vector2(flat[i], flat[i + 1]);
      if (!ring.length || !p.equals(ring[ring.length - 1])) ring.push(p);
    }
    if (ring.length > 1 && ring[0].equals(ring[ring.length - 1])) ring.pop();
    return ring;
  };
  const ring = readRing(flat);
  if (THREE.ShapeUtils.area(ring) > 0) ring.reverse();
  const inner = holes.map(readRing).filter((r) => r.length >= 3);
  for (const hole of inner) if (THREE.ShapeUtils.area(hole) < 0) hole.reverse();
  const all = [ring, ...inner];
  const vertices = all.flat();
  const positions = [], normals = [], uv = [], indices = [];
  for (const p of vertices) {
    positions.push(p.x, height, p.y); normals.push(0, 1, 0); uv.push(p.x, p.y);
  }
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(ring, inner)) {
    const A = vertices[a], B = vertices[b], C = vertices[c];
    const det = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
    indices.push(...(det > 0 ? [a, c, b] : [a, b, c]));
  }
  for (const ring of all) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x, dz = b.y - a.y, length = Math.hypot(dx, dz);
    if (length < 0.001) continue;
    const n = positions.length / 3;
    positions.push(a.x, 0, a.y, b.x, 0, b.y, b.x, height, b.y, a.x, height, a.y);
    for (let k = 0; k < 4; k++) normals.push(-dz / length, 0, dx / length);
    uv.push(0, 0, length, 0, length, height, 0, height);
    indices.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  return geometry;
}
