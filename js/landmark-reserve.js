// js/landmark-reserve.js — pure geometry for keeping the seed's generic buildings out of the real
// landmark footprints (Madrid: OSM rings extruded by js/landmarks.js + the i3s monument volumes).
// Before this module the reserve list was still NYC's (Empire State, Chrysler...), so every Madrid
// lookup missed and the seed massed buildings straight through the landmark masses — flat piedra
// volumes burying detailed facades (Cibeles surroundings, Oct 2026).
//
// No three.js here: this must stay unit-testable in node.

/**
 * Build the reserve set from the LANDMARK_SITES table.
 * @param {Record<string, {ring?: number[], w?: number, d?: number, h?: number}>} sites
 * @param {RegExp} openSpace — names rendered as flat pavement (never massed, seed already keeps them clear)
 * @returns {{ pts: number[], bb: {x0:number,x1:number,z0:number,z1:number} }[]}
 */
export function buildLandmarkReserves(sites, openSpace) {
  const out = [];
  for (const [name, lm] of Object.entries(sites || {})) {
    if (!lm || !lm.ring || lm.ring.length < 6 || !(lm.w >= 12)) continue;
    if (openSpace && openSpace.test(name)) continue;
    const pts = lm.ring; // flat [x0,z0,x1,z1,...] in world frame metres
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i] < x0) x0 = pts[i];
      if (pts[i] > x1) x1 = pts[i];
      if (pts[i + 1] < z0) z0 = pts[i + 1];
      if (pts[i + 1] > z1) z1 = pts[i + 1];
    }
    out.push({ name, pts, bb: { x0, x1, z0, z1 } });
  }
  return out;
}

/** Point-in-polygon (ray cast) over a flat [x,z,...] ring. */
export function ringContains(pts, x, z) {
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2], zi = pts[i * 2 + 1], xj = pts[j * 2], zj = pts[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Subtract the landmark rings from a lot rect by recursive quadtree subdivision: cells whose centre
 * falls inside a ring are dropped, the rest are kept. Rotation-safe: the caller passes `toWorld`
 * (local rect -> world centre) so the split stays in the block's local frame.
 * @param {[number, number, number, number]} r — [x0, x1, z0, z1] in the caller's frame
 * @param {{ pts: number[], bb: {x0,x1,z0,z1} }[]} reserves
 * @param {(cx: number, cz: number) => [number, number]} toWorld — local centre to world centre
 * @param {number} [maxDepth]
 * @returns {[number, number, number, number][]}
 */
export function clipRectByRings(r, reserves, toWorld) {
  const [x0, x1, z0, z1] = r;
  // Pre-filter in WORLD space: with rotated block frames the ring's local bbox may be nowhere near
  // the lot even though its world footprint overlaps (corner transform covers rotation/reflection).
  let wx0 = Infinity, wx1 = -Infinity, wz0 = Infinity, wz1 = -Infinity;
  for (const [cx, cz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
    const [wx, wz] = toWorld(cx, cz);
    if (wx < wx0) wx0 = wx;
    if (wx > wx1) wx1 = wx;
    if (wz < wz0) wz0 = wz;
    if (wz > wz1) wz1 = wz;
  }
  const hits = reserves.filter((h) => h.bb.x0 < wx1 && h.bb.x1 > wx0 && h.bb.z0 < wz1 && h.bb.z1 > wz0);
  if (!hits.length) return [r];
  const kept = [];
  // Adaptive depth: stop subdividing once cells reach ~3 m, so walls get a clean ~3 m setback and
  // nothing fragments below the seed's minimum lot size.
  const maxDepthFor = (a, b, c, d) => Math.max(1, Math.ceil(Math.log2(Math.max(b - a, d - c) / 3)));
  const worldBBox = (a, b, c, d) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [cx, cz] of [[a, c], [b, c], [b, d], [a, d]]) {
      const [wx, wz] = toWorld(cx, cz);
      if (wx < x0) x0 = wx;
      if (wx > x1) x1 = wx;
      if (wz < z0) z0 = wz;
      if (wz > z1) z1 = wz;
    }
    return { x0, x1, z0, z1 };
  };
  const walk = (a, b, c, d, depth) => {
    if (a >= b || c >= d) return;
    const maxDepth = maxDepthFor(a, b, c, d);
    // Early exit: a cell whose world footprint touches no ring stays whole — never fragment the
    // city into micro-lots away from the walls (the 63936-lot blow-up bug).
    const bb = worldBBox(a, b, c, d);
    if (!hits.some((h) => h.bb.x0 < bb.x1 && h.bb.x1 > bb.x0 && h.bb.z0 < bb.z1 && h.bb.z1 > bb.z0)) {
      kept.push([a, b, c, d]);
      return;
    }
    if (depth >= maxDepth) {
      const [wx, wz] = toWorld((a + b) / 2, (c + d) / 2);
      if (!hits.some((h) => ringContains(h.pts, wx, wz))) kept.push([a, b, c, d]);
      return;
    }
    const mx = (a + b) / 2, mz = (c + d) / 2;
    walk(a, mx, c, mz, depth + 1); walk(mx, b, c, mz, depth + 1);
    walk(a, mx, mz, d, depth + 1); walk(mx, b, mz, d, depth + 1);
  };
  walk(x0, x1, z0, z1, 0);
  return kept;
}
