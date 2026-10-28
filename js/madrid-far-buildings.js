import { exposedPartyWallSides } from './madrid-adjacency.js';
import { MADRID_FACADE_OPTS } from './madrid-tiles.js';

const hash = (x, z, salt = 0) => {
  const v = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
  return v - Math.floor(v);
};
const linear = value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const palette = MADRID_FACADE_OPTS.map(o => [16, 8, 0].map(shift => linear(((o.stoneColor >> shift) & 255) / 255)));
const EPS = 1e-6;

// Union boundary of disjoint OBB strips. Caps retain the original cover, including
// patio openings; only coincident internal walls and invisible bottom faces go.
export function buildFarBuildings(parcels, heights) {
  const positions = [], normals = [], colors = [], indices = [];
  const vertices = new Map();
  let nearTriangles = 0, representedParcels = 0;
  const tri = (a, b, c, normal, color) => {
    for (const p of [a, b, c]) {
      const key = [...p, ...normal, ...color].join(',');
      let index = vertices.get(key);
      if (index === undefined) {
        index = positions.length / 3;
        vertices.set(key, index);
        positions.push(...p); normals.push(...normal); colors.push(...color);
      }
      indices.push(index);
    }
  };
  parcels.forEach((p, pi) => {
    if (!p.fp && p.holes?.length) return; // hybrid wells remain in the detailed scene
    const exposed = exposedPartyWallSides(p, heights[pi]);
    const useFootprint = p.fp && !exposed.some(Boolean);
    const f = useFootprint ? p.fp.frame : { ux: 1, uz: 0, vx: 0, vz: 1 };
    const rects = useFootprint ? p.fp.rects.map(r => {
      const uv = r.corners.map(([x, z]) => [x * f.ux + z * f.uz, x * f.vx + z * f.vz]);
      return [Math.min(...uv.map(q => q[0])), Math.min(...uv.map(q => q[1])),
        Math.max(...uv.map(q => q[0])), Math.max(...uv.map(q => q[1]))];
    }) : [[p.x0, p.z0, p.x1, p.z1]];
    nearTriangles += (exposed.some(Boolean) ? 2 : rects.length) * 12;
    representedParcels++;
    const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    const color = palette[Math.floor(hash(cx, cz, p.index) * palette.length) % palette.length];
    const point = (u, v, y) => [u * f.ux + v * f.vx, y, u * f.uz + v * f.vz];
    for (const r of rects) {
      const [u0, v0, u1, v1] = r;
      const a = point(u0, v0, p.h), b = point(u1, v0, p.h);
      const c = point(u1, v1, p.h), d = point(u0, v1, p.h);
      tri(a, d, b, [0, 1, 0], color); tri(b, d, c, [0, 1, 0], color);
      // axis, fixed coordinate, interval endpoints, opposite-edge coordinate index
      for (const [axis, fixed, lo, hi, opposite, reverse] of [
        [0, u0, v0, v1, 2, true], [0, u1, v0, v1, 0, false],
        [1, v0, u0, u1, 3, false], [1, v1, u0, u1, 1, true]
      ]) {
        let intervals = [[lo, hi]];
        for (const q of rects) {
          if (q === r || Math.abs(q[opposite] - fixed) > EPS) continue;
          const qlo = q[axis === 0 ? 1 : 0], qhi = q[axis === 0 ? 3 : 2];
          intervals = intervals.flatMap(([start, end]) => {
            if (qhi <= start || qlo >= end) return [[start, end]];
            const rest = [];
            if (qlo > start) rest.push([start, Math.min(qlo, end)]);
            if (qhi < end) rest.push([Math.max(qhi, start), end]);
            return rest;
          });
        }
        for (const [start, end] of intervals) {
          if (end - start < EPS) continue;
          const s = reverse ? end : start, t = reverse ? start : end;
          const A = axis === 0 ? point(fixed, s, 0) : point(s, fixed, 0);
          const B = axis === 0 ? point(fixed, t, 0) : point(t, fixed, 0);
          const Ah = [A[0], p.h, A[2]], Bh = [B[0], p.h, B[2]];
          const dx = B[0] - A[0], dz = B[2] - A[2], length = Math.hypot(dx, dz);
          const normal = [dz / length, 0, -dx / length];
          tri(A, Ah, B, normal, color); tri(B, Ah, Bh, normal, color);
        }
      }
    }
  });
  return { positions: new Float32Array(positions), normals: new Float32Array(normals),
    colors: new Float32Array(colors), indices: new Uint32Array(indices), triangles: indices.length / 3, nearTriangles, representedParcels };
}
