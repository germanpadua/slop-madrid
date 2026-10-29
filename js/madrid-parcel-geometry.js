import * as THREE from 'three/webgpu';

// Compact extrusion of a sourced footprint: indexed roof + four vertices per wall, no buried bottom cap.
// ExtrudeGeometry's non-indexed bevel-cap machinery is unnecessary for these flat, street-level parcels.
export function createParcelGeometry(flat, height, holes = [], walls = null) {
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
  const kinds = [], tones = [], frames = [];
  const front = walls?.front ?? 1; // WALL_KINDS.entry; rear=2, lotLine=3
  const treatment = (count, kind, frame) => {
    for (let k = 0; k < count; k++) {
      kinds.push(kind); tones.push(walls?.tone ?? 0.5); frames.push(...frame);
    }
  };
  for (const p of vertices) {
    positions.push(p.x, height, p.y); normals.push(0, 1, 0); uv.push(p.x, p.y);
    treatment(1, front, [0, 1, height, 0]);
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
    const wall = (bottom, top, kind) => {
      const n = positions.length / 3;
      positions.push(a.x, bottom, a.y, b.x, bottom, b.y, b.x, top, b.y, a.x, top, a.y);
      for (let k = 0; k < 4; k++) normals.push(-dz / length, 0, dx / length);
      uv.push(0, bottom, length, bottom, length, top, 0, top);
      for (const [s, y] of [[0, bottom], [length, bottom], [length, top], [0, top]]) {
        treatment(1, kind, [s, length, height, height - y]);
      }
      indices.push(n, n + 1, n + 2, n, n + 2, n + 3);
    };
    const bb = walls?.bbox;
    const mx = (a.x + b.x) / 2, mz = (a.y + b.y) / 2;
    const distances = bb ? [Math.abs(mx - bb.x0), Math.abs(mx - bb.x1), Math.abs(mz - bb.z0), Math.abs(mz - bb.z1)] : [];
    const side = distances.indexOf(Math.min(...distances));
    const neighbor = walls?.partyHeights?.[side] ?? 0;
    // Preserve origin's bounded party-wall rule, but split the actual edge rather than stacking boxes.
    const exposed = ring === all[0] && neighbor >= 1 && height - neighbor >= 2.5 && height - neighbor <= height * 0.5;
    if (exposed) { wall(0, neighbor, front); wall(neighbor, height, 3); }
    else wall(0, height, ring === all[0] ? front : 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (walls) {
    geometry.setAttribute('facadeKind', new THREE.Float32BufferAttribute(kinds, 1));
    geometry.setAttribute('facadeTone', new THREE.Float32BufferAttribute(tones, 1));
    geometry.setAttribute('wallFrame', new THREE.Float32BufferAttribute(frames, 4));
  }
  geometry.setIndex(indices);
  return geometry;
}

// Intersect each original hip/ring slope with the triangulated parcel cap. Both inputs are triangles,
// so convex clipping preserves concavities and every real courtyard without an AABB slab over them.
export function createParcelRoofGeometry(flat, holes = [], P, decision) {
  const O = 0.5, R = 0.34, I = 0.20;
  const slopes = [];
  const quad = (a, b, c, d) => slopes.push([a, b, c], [a, c, d]);
  const outer = [[-O, 0, -O], [O, 0, -O], [O, 0, O], [-O, 0, O]];
  if (decision.kind === 'ring') {
    const ridge = [[-R, 1, -R], [R, 1, -R], [R, 1, R], [-R, 1, R]];
    const inner = [[-I, 0.45, -I], [I, 0.45, -I], [I, 0.45, I], [-I, 0.45, I]];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      quad(outer[i], outer[j], ridge[j], ridge[i]);
      quad(ridge[i], ridge[j], inner[j], inner[i]);
    }
  } else {
    const left = [-0.25, 1, 0], right = [0.25, 1, 0];
    quad(outer[0], outer[1], right, left);
    quad(outer[2], outer[3], left, right);
    slopes.push([outer[3], outer[0], left], [outer[1], outer[2], right]);
  }
  const cx = (P.x0 + P.x1) / 2, cz = (P.z0 + P.z1) / 2;
  const rotated = decision.rot !== 0;
  const world = slopes.map((tri) => tri.map(([x, y, z]) => {
    const lx = x * (rotated ? P.d : P.w), lz = z * (rotated ? P.w : P.d);
    return [cx + (rotated ? lz : lx), P.h + y * decision.h, cz + (rotated ? -lx : lz)];
  }));
  const cap = createParcelGeometry(flat, P.h, holes);
  const pos = cap.getAttribute('position'), idx = cap.index;
  const capCount = flat.length / 2 + holes.reduce((n, r) => n + r.length / 2, 0);
  const triangles = [];
  for (let i = 0; i < idx.count; i += 3) {
    const ids = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    // Roof vertices precede wall vertices; normal test also handles repeated closing ring points.
    if (ids.some((n) => n >= capCount || cap.getAttribute('normal').getY(n) < 0.9)) continue;
    triangles.push(ids.map((n) => [pos.getX(n), pos.getZ(n)]));
  }
  const cross = (a, b, p) => (b[0] - a[0]) * (p[2] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const positions = [];
  for (const triangle of triangles) {
    const [a, b, c] = triangle;
    const orient = Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    for (const slope of world) {
      let polygon = slope;
      for (let edge = 0; edge < 3 && polygon.length; edge++) {
        const A = triangle[edge], B = triangle[(edge + 1) % 3], clipped = [];
        for (let i = 0; i < polygon.length; i++) {
          const p = polygon[i], q = polygon[(i + 1) % polygon.length];
          const dp = cross(A, B, p) * orient, dq = cross(A, B, q) * orient;
          if (dp >= -1e-7) clipped.push(p);
          if ((dp >= 0) !== (dq >= 0)) {
            const t = dp / (dp - dq);
            clipped.push(p.map((v, k) => v + t * (q[k] - v)));
          }
        }
        polygon = clipped;
      }
      for (let i = 1; i + 1 < polygon.length; i++) positions.push(...polygon[0], ...polygon[i], ...polygon[i + 1]);
    }
  }
  cap.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
