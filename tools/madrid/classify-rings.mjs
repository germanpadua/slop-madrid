// tools/madrid/classify-rings.mjs — classify the rings of ONE source footprint feature into
// exterior(s) + their holes. Pure and node-testable (no imports).
//
// Why not rings[0] + rings[1:]: ESRI orients exterior CW / holes CCW, but the pipeline flips y->z
// (sign inversion), source services can emit INVALID or REVERSED rings, and multi-part footprints
// or NESTED islands (a building inside a patio) occur in principle even when a sample shows none.
// Rules:
//   - containment is the authority, orientation is only a cross-check;
//   - rings are placed by nesting parity (even-odd rule): a ring inside an exterior is a hole, a
//     ring inside a hole is an ISLAND (a new exterior parcel), and so on;
//   - the container is the SMALLEST placed ring that fully contains the new ring (vertex containment
//     with an RDP-noise tolerance: a vertex may sit up to `tol` metres outside the boundary after
//     independent simplification);
//   - orientation disagreement with the parity-implied role is corrected and counted (`reversed`);
//   - EDGES are validated, not just vertices (all-vertices-inside fails on concave exteriors): any
//     proper edge crossing between a ring and its container (or between sibling holes) fails the
//     WHOLE feature explicitly; partial containment (vertices on both sides beyond tol) and
//     containment in several same-depth rings do too. Nothing is silently dropped or misclassified.
//
// Input rings: world frame (x east, z south), any orientation, each >= 4 points.
// Output: { parcels: [{ ring, holes: [] }], failed: [{ reason, ringCount }], stats }.
// `ring` is normalized to NEGATIVE shoelace (build.mjs convention), holes to POSITIVE.

const shoelace = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
};

const pip = (x, z, r) => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

const segDist = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-12;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
};

const distToBoundary = (x, z, r) => {
  let md = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    md = Math.min(md, segDist(x, z, r[j][0], r[j][1], r[i][0], r[i][1]));
  return md;
};

// containment code of ring q in ring r: 1 = inside (within tol), 0 = outside, -1 = ambiguous
const containment = (q, r, tol) => {
  let sawIn = false, sawOut = false;
  for (const [x, z] of q) {
    if (pip(x, z, r)) sawIn = true;
    else if (distToBoundary(x, z, r) > tol) sawOut = true;
  }
  if (sawIn && sawOut) return -1;
  if (sawIn) return 1;
  if (sawOut) return 0;
  return 1; // every vertex on the boundary within tol: degenerate thin ring, treat as contained
};

// Proper segment intersection (crossing beyond tol of either endpoint; touching is not a crossing).
const segsCross = (a, b, c, d, tol) => {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  if ((o1 > 0) === (o2 > 0) || (o3 > 0) === (o4 > 0)) return false;
  // proper crossing: the intersection must lie beyond tol from all four endpoints
  for (const [p, q, r] of [[c, a, b], [d, a, b], [a, c, d], [b, c, d]])
    if (segDist(p[0], p[1], q[0], q[1], r[0], r[1]) <= tol) return false;
  return true;
};

const ringsCross = (q, r, tol) => {
  for (let i = 0, j = q.length - 1; i < q.length; j = i++)
    for (let k = 0, l = r.length - 1; k < r.length; l = k++)
      if (segsCross(q[j], q[i], r[l], r[k], tol)) return true;
  return false;
};

export function classifyRings(rings, { tol = 0.4, minHoleArea = 4 } = {}) {
  const failed = [];
  const stats = { in: rings.length, reversed: 0, extraExteriors: 0, islands: 0, holesKept: 0, holesDroppedSmall: 0 };
  if (!rings.length) return { parcels: [], failed, stats };
  const fail = (reason) => { failed.push({ reason, ringCount: rings.length }); return { parcels: [], failed, stats }; };

  const order = rings.map((_, i) => i).sort((a, b) => Math.abs(shoelace(rings[b])) - Math.abs(shoelace(rings[a])));
  const placed = []; // { i, depth, ring }
  for (const i of order) {
    const r = rings[i];
    let parent = null;
    for (const p of placed) {
      const c = containment(r, p.ring, tol);
      if (c === -1) return fail('partial-containment');
      if (c === 1 && (!parent || Math.abs(shoelace(p.ring)) < Math.abs(shoelace(parent.ring)))) parent = p;
    }
    const depth = parent ? parent.depth + 1 : 0;
    // orientation cross-check: world frame expects POSITIVE at even depth (exterior/island), NEGATIVE at odd (hole)
    const sign = Math.sign(shoelace(r));
    if ((depth % 2 === 0 && sign < 0) || (depth % 2 === 1 && sign > 0)) stats.reversed++;
    placed.push({ i, depth, ring: r });
  }
  // Edge validity: no proper edge crossing between any ring and its container, nor between sibling holes.
  for (let a = 0; a < placed.length; a++)
    for (let b = a + 1; b < placed.length; b++)
      if (Math.abs(placed[a].depth - placed[b].depth) <= 1 && ringsCross(placed[a].ring, placed[b].ring, tol))
        return fail('boundary-crossing');
  // Emit: even depth = parcel; odd depth = hole of the nearest even-depth ancestor's parcel.
  const parcelOf = new Map(); // placed node -> parcel
  const parcels = [];
  const nodeByIdx = new Map(placed.map((p) => [p.i, p]));
  for (const p of placed) {
    if (p.depth % 2 === 0) {
      const ring = p.ring.slice();
      if (shoelace(ring) > 0) ring.reverse();
      const parcel = { ring, holes: [] };
      parcelOf.set(p.i, parcel);
      parcels.push(parcel);
      if (p.depth > 0) stats.islands++;
      else if (parcels.length > 1) stats.extraExteriors++;
    }
  }
  for (const p of placed) {
    if (p.depth % 2 !== 1) continue;
    if (Math.abs(shoelace(p.ring)) < minHoleArea) { stats.holesDroppedSmall++; continue; }
    // nearest even-depth ancestor: the smallest-area even-depth ring containing this hole
    let owner = null;
    for (const q of placed) {
      if (q.depth % 2 !== 0) continue;
      if (containment(p.ring, q.ring, tol) === 1 && (!owner || Math.abs(shoelace(q.ring)) < Math.abs(shoelace(owner.ring)))) owner = q;
    }
    if (!owner) return fail('orphan-hole');
    const h = p.ring.slice();
    if (shoelace(h) < 0) h.reverse();
    parcelOf.get(owner.i).holes.push(h);
    stats.holesKept++;
  }
  void nodeByIdx;
  return { parcels, failed, stats };
}
