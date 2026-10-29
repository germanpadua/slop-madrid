/**
 * Party-wall (medianera) detection for IDEAM parcels, grounded in the real ring footprints.
 * Each parcel's ring edges are sampled every SAMPLE_M; a sample is "shared" when it lies within
 * TOL_M of another parcel's boundary. Per AABB side (-x, +x, -z, +z) the abutter height is the
 * max height of parcels sharing that side; a side counts as a party wall when the total shared
 * run covers at least FRAC of the side length AND at least MIN_RUN_M absolute. Approximation
 * limits: partial-side party walls are decided by majority; the contour renderer splits its real
 * wall edges at the reported neighbour height. L-shaped notches map to their nearest AABB side; parcels from adjacent tiles are
 * not seen (tile-local only).
 */
const TOL_M = 1.5;
const SAMPLE_M = 1.0;
const FRAC = 0.5;
const MIN_RUN_M = 4.0;

function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = ax + t * dx - px, ez = az + t * dz - pz;
  return Math.hypot(ex, ez);
}

// A shared boundary means coincident WALLS, not near corners: the sample's closest Q edge must be
// (anti-)parallel to P's edge, otherwise a corner touch inflates the shared run by up to 2xTOL.
function nearestParallelEdge(px, pz, ux, uz, q) {
  let best = Infinity;
  for (let k = 0; k < q.length; k++) {
    const [cx, cz] = q[k], [dx, dz] = q[(k + 1) % q.length];
    const ex = dx - cx, ez = dz - cz;
    const L = Math.hypot(ex, ez);
    if (L < 0.3) continue;
    const dot = Math.abs((ux * ex + uz * ez) / L);
    if (dot < 0.7) continue;
    // Interior projection only: a sample past the edge's end is not a shared wall (kills corner inflation)
    const t = ((px - cx) * ex + (pz - cz) * ez) / (L * L);
    if (t < 0 || t > 1) continue;
    best = Math.min(best, Math.hypot(ex * t - (px - cx), ez * t - (pz - cz)));
  }
  return best;
}

/**
 * @param parcels array of { ring: [x,z,...], h, x0, x1, z0, z1 }
 * @returns array of [nHnegX, nHposX, nHnegZ, nHposZ] per parcel (0 = no party wall on that side)
 */
export function partyWallHeights(parcels) {
  // The ring sampler is unchanged; a spatial broad phase avoids scanning every parcel at every metre
  // of wall when a streamed tile contains thousands of contours.
  const cell = 64;
  const bins = new Map();
  parcels.forEach((P, index) => {
    for (let x = Math.floor((P.x0 - TOL_M) / cell); x <= Math.floor((P.x1 + TOL_M) / cell); x++) {
      for (let z = Math.floor((P.z0 - TOL_M) / cell); z <= Math.floor((P.z1 + TOL_M) / cell); z++) {
        const key = `${x},${z}`;
        if (!bins.has(key)) bins.set(key, []);
        bins.get(key).push(index);
      }
    }
  });
  const rings = parcels.map((P) => {
    const pts = [];
    const r = P.ring;
    for (let i = 0; i + 1 < r.length; i += 2) pts.push([r[i], r[i + 1]]);
    return pts;
  });
  const result = [];
  for (let i = 0; i < parcels.length; i++) {
    const P = parcels[i], pts = rings[i];
    const shared = [new Map(), new Map(), new Map(), new Map()]; // side -> (qIndex -> length)
    for (let e = 0; e < pts.length; e++) {
      const [ax, az] = pts[e], [bx, bz] = pts[(e + 1) % pts.length];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.3) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      // Nearest AABB side of this edge's midpoint decides which box face it feeds
      const dSides = [Math.abs(mx - P.x0), Math.abs(mx - P.x1), Math.abs(mz - P.z0), Math.abs(mz - P.z1)];
      const side = dSides.indexOf(Math.min(...dSides));
      const n = Math.max(1, Math.round(L / SAMPLE_M));
      for (let sIdx = 0; sIdx < n; sIdx++) {
        const t = (sIdx + 0.5) / n;
        const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
        const candidates = bins.get(`${Math.floor(px / cell)},${Math.floor(pz / cell)}`) || [];
        for (const j of candidates) {
          if (j === i) continue;
          const Q = parcels[j];
          if (px < Q.x0 - TOL_M || px > Q.x1 + TOL_M || pz < Q.z0 - TOL_M || pz > Q.z1 + TOL_M) continue;
          if (nearestParallelEdge(px, pz, ux, uz, rings[j]) <= TOL_M) shared[side].set(j, (shared[side].get(j) || 0) + L / n);
        }
      }
    }
    const sideLen = [P.z1 - P.z0, P.z1 - P.z0, P.x1 - P.x0, P.x1 - P.x0];
    const out = [0, 0, 0, 0];
    for (let s = 0; s < 4; s++) {
      let total = 0, hMax = 0;
      for (const [j, len] of shared[s]) {
        total += len;
        if (len >= MIN_RUN_M) hMax = Math.max(hMax, parcels[j].h);
      }
      if (total >= Math.max(FRAC * sideLen[s], MIN_RUN_M) && hMax > 0) out[s] = hMax;
    }
    result.push(out);
  }
  return result;
}
