// Positive-area overlap of a generated convex footprint and a source landmark ring.
// Bounds are only an early reject: concave recesses and boundary-only contact stay free.
const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const EPS = 1e-7;
function inside(p, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if (Math.abs(cross(a, b, p)) < EPS && p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS &&
        p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS) return false;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
export function footprintsOverlap(a, b) {
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const p = a[i], q = a[(i + 1) % a.length], r = b[j], s = b[(j + 1) % b.length];
    if (cross(p, q, r) * cross(p, q, s) < -EPS && cross(r, s, p) * cross(r, s, q) < -EPS) return true;
  }
  // Midpoints handle coincident edges with overlapping interiors; strict containment excludes touch-only.
  const probes = (ring) => [...ring, ...ring.map((p, i) => {
    const q = ring[(i + 1) % ring.length]; return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  })];
  if (probes(a).some((p) => inside(p, b)) || probes(b).some((p) => inside(p, a))) return true;
  const centre = a.reduce((sum, p) => [sum[0] + p[0] / a.length, sum[1] + p[1] / a.length], [0, 0]);
  return inside(centre, a) && inside(centre, b);
}
export function createMadridLandmarkReserves(sites) {
  return Object.entries(sites).filter(([, lm]) => lm?.building === 1 && lm.ring?.length >= 6 && lm.w >= 12)
    .map(([name, lm]) => {
      const ring = [];
      for (let i = 0; i < lm.ring.length; i += 2) ring.push([lm.ring[i], lm.ring[i + 1]]);
      return { name, ring, minX: Math.min(...ring.map((p) => p[0])), maxX: Math.max(...ring.map((p) => p[0])),
        minZ: Math.min(...ring.map((p) => p[1])), maxZ: Math.max(...ring.map((p) => p[1])) };
    });
}
export function overlapsMadridLandmark(footprint, reserves) {
  const xs = footprint.map((p) => p[0]), zs = footprint.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  return reserves.some((r) => r.minX < maxX && r.maxX > minX && r.minZ < maxZ && r.maxZ > minZ && footprintsOverlap(footprint, r.ring));
}
