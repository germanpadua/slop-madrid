// js/madrid-ground-clip.js — PURE geometry (no three): clip a road polyline against the ground rings that paint
// park floors, for TileRoadRibbons (js/madrid-tile-world.js). Kept in its own module so the crossing / boundary /
// water / nested-ring / non-convex cases are covered by tools/madrid/ground-clip.test.mjs — screenshots alone
// cannot cover those combinations.
//
// Contract:
//   pts:   [{x,z}, ...] source road polyline (world units).
//   rings: [{ring: [{x,z}, ...], bb: [x0,z0,x1,z1]}, ...] ground rings that paint (dirt or lawn), any order.
//   opts.inWater(x, z): optional predicate - pieces whose midpoint lies in water are skipped (bridge decks own them).
//   opts.minLen: minimum piece length (default 2).
//   opts.obstacles: [{a, b, wHalf}] wider corridors that OWN crossings (road ribbons vs footpaths): pieces are
//     SPLIT at the stadium boundary (radius wHalf + opts.selfHalf) of every obstacle and only the sub-pieces
//     whose midpoint falls inside the band are dropped - a crossing cuts the overlap, never the whole piece.
//   opts.selfHalf: half-width of the clipped way itself (default 0), widens obstacle bands.
// Returns { pieces: [{a:{x,z}, b:{x,z}}], joints: [{x,z}] }:
//   pieces are the in-ring stretches, each segment SPLIT at every boundary crossing (never midpoint-only, so a
//   segment whose ends are inside a non-convex ring but whose middle is outside yields two pieces); a stretch
//   covered by two overlapping/nested rings is emitted once (first ring in the list wins). joints are the original
//   polyline vertices where two kept pieces meet (turn caps).

export const pointInRing = (ring, x, z) => {
  let h = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) h = !h;
  }
  return h;
};

export const ringBBox = (ring) => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of ring) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
  return [x0, z0, x1, z1];
};

// param t along ab of the crossing with cd, or null (proper crossings only; endpoint touches on cd allowed)
const segT = (a, b, c, d) => {
  const rx = b.x - a.x, rz = b.z - a.z, sx = d.x - c.x, sz = d.z - c.z;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den;
  const u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
};


// pointInWaterBoxes: true when (x,z) lies in a water box. Contract: boxes carry OBJECT bbs ({x0,z0,x1,z1},
// the shape world.js bboxOf returns). The bbox is a cheap gate; the ring decides. (Regression guard: a prior
// version read array indices on these objects and the predicate silently never fired.)
export const pointInWaterBoxes = (boxes, x, z) => boxes.some((wb) => x >= wb.bb.x0 && x <= wb.bb.x1 && z >= wb.bb.z0 && z <= wb.bb.z1 && pointInRing(wb.ring, x, z));

export const segPointDist = (p, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
};

// t values in (0,1) where segment ab crosses the stadium boundary of radius r around segment cd
// (two offset lines on the segment interior + two radius-r circles on the endpoints).
const stadiumCuts = (a, b, c, d, r) => {
  const ts = [];
  const ux = d.x - c.x, uz = d.z - c.z;
  const len = Math.hypot(ux, uz);
  if (len > 1e-12) {
    const nx = -uz / len, nz = ux / len;
    const da = (a.x - c.x) * nx + (a.z - c.z) * nz;
    const db = (b.x - c.x) * nx + (b.z - c.z) * nz;
    for (const s of [r, -r]) {
      const den = da - db;
      if (Math.abs(den) < 1e-12) continue;
      const t = (da - s) / den;
      if (t <= 1e-9 || t >= 1 - 1e-9) continue;
      const px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
      const u = ((px - c.x) * ux + (pz - c.z) * uz) / (len * len);
      if (u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
    }
  }
  for (const p of [c, d]) {
    const ex = a.x - p.x, ez = a.z - p.z;
    const vx = b.x - a.x, vz = b.z - a.z;
    const A = vx * vx + vz * vz;
    if (A < 1e-12) continue;
    const B = 2 * (ex * vx + ez * vz);
    const C = ex * ex + ez * ez - r * r;
    const disc = B * B - 4 * A * C;
    if (disc <= 1e-12) continue;
    for (const sgn of [-1, 1]) {
      const t = (-B + sgn * Math.sqrt(disc)) / (2 * A);
      if (t > 1e-9 && t < 1 - 1e-9) ts.push(t);
    }
  }
  return ts.sort((p, q) => p - q);
};

export function clipRoadToRings(pts, rings, opts = {}) {
  const { inWater = null, minLen = 2, obstacles = null, selfHalf = 0 } = opts;
  const pieces = [], joints = [];
  if (!pts || pts.length < 2) return { pieces, joints };
  let rx0 = Infinity, rz0 = Infinity, rx1 = -Infinity, rz1 = -Infinity;
  for (const p of pts) { rx0 = Math.min(rx0, p.x); rz0 = Math.min(rz0, p.z); rx1 = Math.max(rx1, p.x); rz1 = Math.max(rz1, p.z); }
  const prevRings = [];
  for (const g of rings) {
    const bb = g.bb || ringBBox(g.ring);
    if (bb[2] < rx0 || bb[0] > rx1 || bb[3] < rz0 || bb[1] > rz1) continue;
    const R = g.ring;
    const kept = []; // {a, b, startV, endV}: startV/endV = original vertex index when the endpoint IS that vertex
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (Math.max(a.x, b.x) < bb[0] || Math.min(a.x, b.x) > bb[2] || Math.max(a.z, b.z) < bb[1] || Math.min(a.z, b.z) > bb[3]) continue;
      const ts = [];
      for (let j = 0, k = R.length - 1; j < R.length; k = j++) {
        const t = segT(a, b, R[k], R[j]);
        if (t !== null) ts.push(t);
      }
      if (obstacles) for (const o of obstacles) ts.push(...stadiumCuts(a, b, o.a, o.b, o.wHalf + selfHalf));
      ts.sort((p, q) => p - q);
      const cuts = [0, ...ts, 1];
      for (let s = 0; s + 1 < cuts.length; s++) {
        const t0 = cuts[s], t1 = cuts[s + 1];
        if (t1 - t0 < 1e-6) continue;
        const p0 = { x: a.x + (b.x - a.x) * t0, z: a.z + (b.z - a.z) * t0 };
        const p1 = { x: a.x + (b.x - a.x) * t1, z: a.z + (b.z - a.z) * t1 };
        const mx = (p0.x + p1.x) / 2, mz = (p0.z + p1.z) / 2;
        if (!pointInRing(R, mx, mz)) continue;
        if (Math.hypot(p1.x - p0.x, p1.z - p0.z) < minLen) continue;
        if (inWater && inWater(mx, mz)) continue;
        if (obstacles && obstacles.some((o) => segPointDist({ x: mx, z: mz }, o.a, o.b) < o.wHalf + selfHalf - 1e-9)) continue;
        if (prevRings.some((o) => pointInRing(o.ring, mx, mz))) continue;
        kept.push({ a: p0, b: p1, startV: t0 <= 1e-9 ? i - 1 : -1, endV: t1 >= 1 - 1e-9 ? i : -1 });
      }
    }
    const startVs = new Set(), endVs = new Set();
    for (const p of kept) { if (p.startV >= 0) startVs.add(p.startV); if (p.endV >= 0) endVs.add(p.endV); }
    for (const p of kept) pieces.push({ a: p.a, b: p.b });
    for (const v of startVs) if (endVs.has(v)) joints.push({ x: pts[v].x, z: pts[v].z });
    prevRings.push(g);
  }
  return { pieces, joints };
}

// ringsCross: true when any edge of ring a properly crosses any edge of ring b (endpoint touches allowed).
export const ringsCross = (a, b) => {
  for (let i = 0, j = a.length - 1; i < a.length; j = i++)
    for (let k = 0, l = b.length - 1; k < b.length; l = k++)
      if (segT(a[j], a[i], b[l], b[k]) !== null) return true;
  return false;
};

// ringsContained: the candidate rings that lie FULLY inside the outer ring - bbox gate, every vertex inside,
// and no boundary crossing. A candidate touching or crossing the boundary is excluded (conservative: cutting it
// as a hole would tear the outer ring's triangulation). Used to cut exact holes for stacked ground layers.
export function ringsContained(outer, outerBB, candidates) {
  const out = [];
  for (const g of candidates) {
    const bb = g.bb || ringBBox(g.ring);
    if (bb[0] < outerBB[0] || bb[2] > outerBB[2] || bb[1] < outerBB[1] || bb[3] > outerBB[3]) continue;
    if (!g.ring.every((q) => pointInRing(outer, q.x, q.z))) continue;
    if (ringsCross(outer, g.ring)) continue;
    out.push(g);
  }
  return out;
}
