// js/madrid-footprint.js — footprint-aware massing, pure and node-testable (no three imports).
// Decomposes a cadastral ring (flat [x0,z0,x1,z1,...]) into a set of rectangles so block-perimeter
// parcels stop rendering as one AABB slab that swallows the courtyard (visual rejection 2026-10-28).
//
// Method: minimum-area oriented bounding box (rotating calipers over the convex hull) gives the local
// frame; the polygon is then sliced along the minor axis into strips of ~stripW metres; each strip's
// intersection with the polygon yields one or more x-intervals, each interval becoming one rectangle.
// This is an APPROXIMATION: diagonal/curved boundaries are stair-stepped. Intervals are the
// conservative inner fit of both slab edges, so error is UNDER-coverage only (a strip never extends
// past the source ring). The caller must check `deviation` (symmetric-difference area ratio,
// estimated numerically) and fall back to the AABB box when it exceeds their threshold.
//
// Lightweight contract: rectangles only feed the EXISTING instanced facade boxes; no new shader work.

const pts = (ring) => {
  const p = [];
  for (let i = 0; i + 1 < ring.length; i += 2) p.push([ring[i], ring[i + 1]]);
  return p;
};

const area2 = (poly) => {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return a / 2;
};

// Convex hull (Andrew monotone chain) for the rotating-calipers OBB.
const hull = (p) => {
  const s = [...p].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of s) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (const q of [...s].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
};

// Minimum-area OBB over the hull edges. Returns { ux, uz, vx, vz } orthonormal axes (u = major axis).
const obbFrame = (p) => {
  const h = hull(p);
  let best = null;
  for (let i = 0, j = h.length - 1; i < h.length; j = i++) {
    const ex = h[i][0] - h[j][0], ez = h[i][1] - h[j][1];
    const len = Math.hypot(ex, ez);
    if (len < 1e-9) continue;
    const ux = ex / len, uz = ez / len, vx = -uz, vz = ux;
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const q of p) {
      const u = q[0] * ux + q[1] * uz, v = q[0] * vx + q[1] * vz;
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const a = (u1 - u0) * (v1 - v0);
    if (!best || a < best.a) best = { a, ux, uz, vx, vz };
  }
  return best;
};

const toUV = (q, f) => [q[0] * f.ux + q[1] * f.uz, q[0] * f.vx + q[1] * f.vz];

// Intersect two sorted disjoint interval sets (1D). Used to combine the scans at both slab edges.
const intersectSets = (A, B) => {
  const out = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    const a = Math.max(A[i][0], B[j][0]), b = Math.min(A[i][1], B[j][1]);
    if (b - a > 0) out.push([a, b]);
    if (A[i][1] < B[j][1]) i++; else j++;
  }
  return out;
};

// Union of two sorted disjoint interval sets.
const unionSets = (A, B) => {
  const out = [];
  const all = [...A, ...B].sort((a, b) => a[0] - b[0]);
  for (const [a, b] of all) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
};

// A minus B for sorted disjoint interval sets.
const subtractSets = (A, B) => {
  const out = [];
  let j = 0;
  for (let [a, b] of A) {
    while (j < B.length && B[j][1] <= a) j++;
    let k = j;
    while (k < B.length && B[k][0] < b) {
      if (B[k][0] > a) out.push([a, Math.min(b, B[k][0])]);
      a = Math.max(a, B[k][1]);
      if (a >= b) break;
      k++;
    }
    if (a < b) out.push([a, b]);
  }
  return out;
};


// Does the axis-aligned uv rect [u0,v0]-[u1,v1] overlap polygon h (pairs)? Vertex-in-rect,
// rect-corner-in-poly, or any edge crossing - cheap exact-enough test for the merge invariant.
const rectPolyOverlap = (u0, v0, u1, v1, h) => {
  for (const [x, y] of h) if (x > u0 && x < u1 && y > v0 && y < v1) return true;
  const rc = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  for (const [x, y] of rc) if (inPoly(h, x, y)) return true;
  for (let i = 0, j = h.length - 1; i < h.length; j = i++) {
    const [ax, ay] = h[j], [bx, by] = h[i];
    for (let k = 0; k < 4; k++) {
      const [cx, cy] = rc[k], [dx, dy] = rc[(k + 1) % 4];
      const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
      const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
      const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
      if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return true;
    }
  }
  return false;
};

// Intersect the polygon (in uv frame) with the horizontal line v = vv; returns sorted x-intervals.
const sliceIntervals = (poly, vv) => {
  const xs = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [uj, vj] = poly[j], [ui, vi] = poly[i];
    if ((vj <= vv && vi > vv) || (vi <= vv && vj > vv)) {
      xs.push(uj + (ui - uj) * ((vv - vj) / (vi - vj)));
    }
  }
  xs.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
};

// Point-in-polygon (uv frame) for the deviation estimate.
const inPoly = (poly, u, v) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [uj, vj] = poly[j], [ui, vi] = poly[i];
    if ((vi > v) !== (vj > v) && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) inside = !inside;
  }
  return inside;
};

/**
 * decomposeRing(ring, { stripW = 6, minW = 2, minD = 2, samples = 24 }):
 * -> { rects: [{ x0, z0, x1, z1 }] (world coords), deviation: 0..1, frame, areaPoly, areaRects }
 * deviation = |areaRects - areaPoly| / areaPoly (over-approximation of the symmetric difference:
 * rects are clipped to the polygon's v-extent per strip so overlap error dominates).
 */
export function decomposeRing(ring, { stripW = 6, minW = 2, minD = 2, holes = [] } = {}) {
  const p = pts(ring);
  if (p.length < 3) return { rects: [], deviation: 1 };
  const holePs = holes.map(pts).filter((hp) => hp.length >= 3);
  const f = obbFrame(p);
  const uv = p.map((q) => toUV(q, f));
  const uvHoles = holePs.map((hp) => hp.map((q) => toUV(q, f)));
  let v0 = 1e9, v1 = -1e9;
  for (const q of uv) { v0 = Math.min(v0, q[1]); v1 = Math.max(v1, q[1]); }
  const depth = v1 - v0;
  // Slab boundaries: at every polygon vertex v (so axis-aligned edges get exact, coherent spans) with
  // any slab taller than stripW subdivided (bounds the wedge error where diagonal edges cross).
  const vEvents = [...new Set(uv.map((q) => q[1]))].sort((a, b) => a - b);
  const slabs = [];
  for (let i = 0; i + 1 < vEvents.length; i++) {
    const a = vEvents[i], b = vEvents[i + 1];
    const n = Math.max(1, Math.ceil((b - a) / stripW));
    for (let k = 0; k < n; k++) slabs.push([a + (k * (b - a)) / n, a + ((k + 1) * (b - a)) / n]);
  }
  if (!slabs.length) slabs.push([v0, v1]);
  const rects = [];
  for (const [sz0, sz1] of slabs) {
    const dh = sz1 - sz0;
    // Conservative inner fit: intersect the scans at BOTH slab edges. Every boundary edge is linear
    // in v within a slab (slabs are split at vertex v-events), so the intersection lies inside the
    // polygon for the whole slab - strips under-cover but never over-cover into a neighbour parcel
    // (roofs sit on strips; over-cover made them pierce taller neighbours, street-view wedge).
    const eps = Math.min(0.02, dh * 0.01);
    let iv = intersectSets(sliceIntervals(uv, sz0 + eps), sliceIntervals(uv, sz1 - eps));
    // Source holes (real patios/openings): subtract their OUTER fit (union of both edge scans), so
    // no strip mass ever remains inside a hole; the error stays one-directional (under-coverage).
    if (uvHoles.length) {
      // Outer fit of (hole ∩ slab): scan at the slab edges AND at every hole-vertex v inside the
      // slab - a hole floating inside a tall slab is missed by the edge scans alone (the extremes
      // of the intersection occur at hole vertices or band crossings, all covered by these lines).
      let hv = [];
      for (const h of uvHoles) {
        const lines = [sz0 + eps, sz1 - eps];
        for (const q of h) if (q[1] > sz0 + 2 * eps && q[1] < sz1 - 2 * eps) lines.push(q[1]);
        for (const vv of lines) hv = unionSets(hv, sliceIntervals(h, vv));
      }
      iv = subtractSets(iv, hv);
    }
    for (const [a, b] of iv) {
      const w = b - a;
      if (w < minW || dh < minD) continue;
      // Rect corners back to world coords
      const corners = [[a, sz0], [b, sz0], [b, sz1], [a, sz1]]
        .map(([u, v]) => [u * f.ux + v * f.vx, u * f.uz + v * f.vz]);
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const [x, z] of corners) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      rects.push({ x0, z0, x1, z1, corners });
    }
  }
  // Merge vertically adjacent rects with matching u-intervals (orthogonal regions collapse into few
  // coherent spans; diagonal regions keep their thin strips). Two passes are enough for slab stacks.
  for (let pass = 0; pass < 4; pass++) {
    let merged = false;
    for (let i = 0; i < rects.length && !merged; i++) {
      for (let j = i + 1; j < rects.length && !merged; j++) {
        const A = rects[i].corners, B = rects[j].corners;
        // corners: [bl, br, tr, tl] in uv
        const Abl = A[0], Abr = A[1], Atl = A[3], Bbl = B[0], Bbr = B[1], Btl = B[3];
        // uv-space coords
        const uvA = (q) => q; // corners were converted to world; recompute uv below instead
        // Recover uv bounds from world corners via frame
        const toUv2 = (c) => [c[0] * f.ux + c[1] * f.uz, c[0] * f.vx + c[1] * f.vz];
        const au = A.map(toUv2), bu = B.map(toUv2);
        const aU0 = Math.min(...au.map((q) => q[0])), aU1 = Math.max(...au.map((q) => q[0]));
        const aV0 = Math.min(...au.map((q) => q[1])), aV1 = Math.max(...au.map((q) => q[1]));
        const bU0 = Math.min(...bu.map((q) => q[0])), bU1 = Math.max(...bu.map((q) => q[0]));
        const bV0 = Math.min(...bu.map((q) => q[1])), bV1 = Math.max(...bu.map((q) => q[1]));
        const tol = 0.15;
        if (Math.abs(aU0 - bU0) < tol && Math.abs(aU1 - bU1) < tol &&
            (Math.abs(aV1 - bV0) < 0.01 || Math.abs(bV1 - aV0) < 0.01)) {
          const nV0 = Math.min(aV0, bV0), nV1 = Math.max(aV1, bV1);
          const u0m = (aU0 + bU0) / 2, u1m = (aU1 + bU1) / 2;
          // No-hole-intrusion invariant: the averaged u-bounds may pull an edge into a hole; reject
          // the merge if the merged uv-rect overlaps any hole polygon.
          if (uvHoles.some((h) => rectPolyOverlap(u0m, nV0, u1m, nV1, h))) continue;
          rects[i].corners = [[u0m, nV0], [u1m, nV0], [u1m, nV1], [u0m, nV1]]
            .map(([u, v]) => [u * f.ux + v * f.vx, u * f.uz + v * f.vz]);
          // refresh world AABB
          let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
          for (const [x, z] of rects[i].corners) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
          Object.assign(rects[i], { x0, x1, z0, z1 });
          rects.splice(j, 1);
          merged = true;
        }
      }
    }
    if (!merged) break;
  }
  const areaPoly = Math.abs(area2(p));
  // Numeric deviation: sample the OBB on a grid, count disagreements between polygon and rect cover.
  let u0 = 1e9, u1 = -1e9;
  for (const q of uv) { u0 = Math.min(u0, q[0]); u1 = Math.max(u1, q[0]); }
  const NU = 48, NV = 48;
  let diff = 0, tot = 0;
  // The 48×48 deviation probe tests the same rectangles repeatedly. Project
  // their bounds once, keeping the exact comparisons and original precision.
  const uvRects = rects.map((r) => {
    const c = r.corners.map(([x, z]) => [x * f.ux + z * f.uz, x * f.vx + z * f.vz]);
    let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
    for (const q of c) { a0 = Math.min(a0, q[0]); a1 = Math.max(a1, q[0]); b0 = Math.min(b0, q[1]); b1 = Math.max(b1, q[1]); }
    return [a0, a1, b0, b1];
  });
  const inRect = (u, v) => {
    for (const [a0, a1, b0, b1] of uvRects) {
      if (u >= a0 && u <= a1 && v >= b0 && v <= b1) return true;
    }
    return false;
  };
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const u = u0 + ((i + 0.5) / NU) * (u1 - u0), v = v0 + ((j + 0.5) / NV) * (v1 - v0);
    const a = inPoly(uv, u, v) && !uvHoles.some((h) => inPoly(h, u, v)), b = inRect(u, v);
    if (a || b) tot++;
    if (a !== b) diff++;
  }
  const deviation = tot ? diff / tot : 1;
  const areaRects = rects.reduce((acc, r) => {
    const c = r.corners;
    const w = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]);
    const d = Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1]);
    return acc + w * d;
  }, 0);
  return { rects, deviation, areaPoly, areaRects, frame: f };
}
