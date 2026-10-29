// Match only mapped, marked crossings onto a resident physical carriageway.
// Positions come from OSM; road width and zebra depth remain illustrative.
export function matchMarkedCrossings(edges, crossings, maxDistance = 3) {
  const matches = [];
  const seen = new Set();
  const grid = new Map(), cell = 64;
  for (const e of edges) {
    if (!(e.span > 0) || !(e.half > 0)) continue;
    const x1 = e.x0 + e.dx * e.span, z1 = e.z0 + e.dz * e.span;
    for (let ix = Math.floor((Math.min(e.x0,x1)-maxDistance)/cell); ix <= Math.floor((Math.max(e.x0,x1)+maxDistance)/cell); ix++) {
      for (let iz = Math.floor((Math.min(e.z0,z1)-maxDistance)/cell); iz <= Math.floor((Math.max(e.z0,z1)+maxDistance)/cell); iz++) {
        const key = `${ix}:${iz}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(e);
      }
    }
  }
  for (const [id, x, z] of crossings) {
    if (seen.has(id)) continue;
    let best = null, bestDistance = maxDistance;
    for (const e of grid.get(`${Math.floor(x/cell)}:${Math.floor(z/cell)}`) || []) {
      if (!(e.span > 0) || !(e.half > 0)) continue;
      const s = (x - e.x0) * e.dx + (z - e.z0) * e.dz;
      if (s < -0.5 || s > e.span + 0.5) continue;
      const distance = Math.hypot(x - e.x0 - e.dx * s, z - e.z0 - e.dz * s);
      if (distance < bestDistance) { bestDistance = distance; best = { e, s: (x - e.sx) * e.dx + (z - e.sz) * e.dz, id }; }
    }
    if (best) { seen.add(id); matches.push(best); }
  }
  return matches;
}
