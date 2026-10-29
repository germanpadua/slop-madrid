/**
 * Party-wall (medianera) detection for IDEAM parcels, grounded in the real ring footprints.
 * Each parcel's ring edges are sampled every SAMPLE_M; a sample is "shared" when it lies within
 * TOL_M of another parcel's boundary. Per AABB side (-x, +x, -z, +z) the abutter height is the
 * max height of parcels sharing that side; a side counts as a party wall when the total shared
 * run covers at least FRAC of the side length AND at least MIN_RUN_M absolute. Approximation
 * limits (honest): the box renderer paints whole faces, so partial-side party walls are decided
 * by majority; L-shaped notches map to their nearest AABB side; parcels from adjacent tiles are
 * not seen (tile-local only).
 *
 * Performance: partyWallHeights and partyWallRuns need the same per-sample nearest-wall scan,
 * so both read one combined analysis pass (cached per parcels array, WeakMap). The pass keeps
 * the original iteration order (edges -> samples -> candidates in insertion order) and the
 * original Math.hypot arithmetic, so outputs are bit-identical to running the two scans.
 */
const TOL_M = 1.5;
const SAMPLE_M = 1.0;
const FRAC = 0.5;
const MIN_RUN_M = 4.0;

// A shared boundary means coincident WALLS, not near corners: the sample's closest Q edge must be
// (anti-)parallel to P's edge, otherwise a corner touch inflates the shared run by up to 2xTOL.
function nearestParallelEdge(px, pz, ux, uz, q) {
  let best = Infinity;
  for (let k = 0; k < q.length; k++) {
    const qk = q[k], qn = q[(k + 1) % q.length];
    const cx = qk[0], cz = qk[1], dx = qn[0], dz = qn[1];
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

// Broad phase only: every parcel whose expanded bounds contain a sample is in
// its cell. Insertion order preserves the original parcel order and tie behavior.
// Integer cell keys (string keys dominated the profile); the bucketing is unchanged.
const CELL = 32;
const CELL_KEY = (cx, cz) => (cx + 4096) * 8192 + (cz + 4096);
function candidateLookup(parcels) {
  const cells = new Map();
  parcels.forEach((p, i) => {
    for (let x = Math.floor((p.x0 - TOL_M) / CELL); x <= Math.floor((p.x1 + TOL_M) / CELL); x++) {
      for (let z = Math.floor((p.z0 - TOL_M) / CELL); z <= Math.floor((p.z1 + TOL_M) / CELL); z++) {
        const key = CELL_KEY(x, z);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(i);
      }
    }
  });
  const empty = [];
  return (x, z) => cells.get(CELL_KEY(Math.floor(x / CELL), Math.floor(z / CELL))) || empty;
}

const analysisCache = new WeakMap();

function analyze(parcels) {
  const cached = analysisCache.get(parcels);
  if (cached) return cached;
  const rings = parcels.map((P) => {
    const pts = [];
    const r = P.ring;
    for (let i = 0; i + 1 < r.length; i += 2) pts.push([r[i], r[i + 1]]);
    return pts;
  });
  const candidates = candidateLookup(parcels);
  const heights = [];
  const runsOut = [];
  for (let i = 0; i < parcels.length; i++) {
    const P = parcels[i], pts = rings[i];
    const shared = [new Map(), new Map(), new Map(), new Map()]; // side -> (qIndex -> length)
    const perEdge = [];
    for (let e = 0; e < pts.length; e++) {
      const pe = pts[e], pn = pts[(e + 1) % pts.length];
      const ax = pe[0], az = pe[1], bx = pn[0], bz = pn[1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.3) { perEdge.push([]); continue; }
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      // Nearest AABB side of this edge's midpoint decides which box face it feeds (first min wins)
      const d0 = Math.abs(mx - P.x0), d1 = Math.abs(mx - P.x1), d2 = Math.abs(mz - P.z0), d3 = Math.abs(mz - P.z1);
      let side = 0;
      if (d1 < d0) side = 1;
      if (d2 < (side === 1 ? d1 : d0)) side = 2;
      if (d3 < (side === 2 ? d2 : side === 1 ? d1 : d0)) side = 3;
      const n = Math.max(1, Math.round(L / SAMPLE_M));
      const marks = new Array(n).fill(0); // 0 = exposed, else abutter height
      for (let sIdx = 0; sIdx < n; sIdx++) {
        const t = (sIdx + 0.5) / n;
        const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
        for (const j of candidates(px, pz)) {
          if (j === i) continue;
          const Q = parcels[j];
          if (px < Q.x0 - TOL_M || px > Q.x1 + TOL_M || pz < Q.z0 - TOL_M || pz > Q.z1 + TOL_M) continue;
          const d = nearestParallelEdge(px, pz, ux, uz, rings[j]);
          if (d <= TOL_M) shared[side].set(j, (shared[side].get(j) || 0) + L / n);
          // Overlay use: only COINCIDENT walls (d <= 0.5m) count as party wall; 0.5-1.5m is source
          // uncertainty (noisy twin walls) - left glazed and reported, never blanked or bridged.
          if (d <= 0.5) marks[sIdx] = Math.max(marks[sIdx], Q.h);
        }
      }
      const runs = [];
      let s0 = -1;
      for (let sIdx = 0; sIdx <= n; sIdx++) {
        const on = sIdx < n && marks[sIdx] > 0;
        if (on && s0 < 0) s0 = sIdx;
        if (!on && s0 >= 0) {
          let h = 0;
          for (let k = s0; k < sIdx; k++) h = Math.max(h, marks[k]);
          const t0 = s0 / n, t1 = sIdx / n;
          if ((t1 - t0) * L >= MIN_RUN_M) runs.push({ t0, t1, h });
          s0 = -1;
        }
      }
      perEdge.push(runs);
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
    heights.push(out);
    runsOut.push(perEdge);
  }
  const analysis = { heights, runs: runsOut };
  analysisCache.set(parcels, analysis);
  return analysis;
}

/**
 * @param parcels array of { ring: [x,z,...], h, x0, x1, z0, z1 }
 * @returns array of [nHnegX, nHposX, nHnegZ, nHposZ] per parcel (0 = no party wall on that side)
 */
export function partyWallHeights(parcels) {
  return analyze(parcels).heights;
}

/**
 * Per-edge shared wall runs for the hybrid (extruded-ring) renderer: for each ring edge, the
 * [t0,t1] intervals where a parallel neighbour wall sits within TOL_M, with the max abutter height.
 * Same sampling/parallel-edge rules as partyWallHeights; runs shorter than MIN_RUN_M are dropped.
 * @returns array per parcel of array per edge of { t0, t1, h }
 */
export function partyWallRuns(parcels) {
  return analyze(parcels).runs;
}

// A whole-AABB facade split would fill real patios even when footprint strips
// already describe them correctly. Keep those strips and their openings intact.
export function exposedPartyWallSides(parcel, heights) {
  if (parcel.fp && parcel.holes?.length) return [false, false, false, false];
  return heights.map(n => n >= 1 && parcel.h - n >= 2.5 && parcel.h - n <= parcel.h * 0.5);
}
