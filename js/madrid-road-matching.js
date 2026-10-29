// Match an actor's world pose onto the lane graph of a freshly prepared network. The resident
// edges are rebuilt whenever tiles stream, so identity is geometric (position + heading): an actor
// with no equivalent lane must be retired by the caller instead of keeping a stale edge reference.
// Kept free of scene state so the retention/retirement rules can be tested without WebGPU.
export function matchLane(edges, pose) {
  const { x, z, tx, tz, half, halfWidth, bus = false } = pose;
  const forwardX = tx || 0;
  const forwardZ = tz || 1;
  const laneLimit = Math.max(halfWidth + 1.1, 2.0);
  let best = null;
  for (const edge of edges) {
    if (bus && edge.axis !== 'ave') continue;
    if (edge.len < 2 * half + 1) continue;
    const alignment = edge.dx * forwardX + edge.dz * forwardZ;
    if (alignment < 0.72) continue;
    const raw = (x - edge.sx) * edge.dx + (z - edge.sz) * edge.dz;
    if (raw < -half - 3 || raw > edge.len + half + 3) continue;
    const s = Math.max(0, Math.min(edge.len, raw));
    const dx = x - (edge.sx + edge.dx * s);
    const dz = z - (edge.sz + edge.dz * s);
    const lateral = dx * edge.rx + dz * edge.rz;
    let lane = 0;
    let laneError = Infinity;
    for (let i = 0; i < edge.lanes.length; i++) {
      const error = Math.abs(lateral - edge.lanes[i]);
      if (error < laneError) { laneError = error; lane = i; }
    }
    if (laneError > laneLimit) continue;
    const score = laneError + (1 - alignment) * 8 + Math.abs(dx * edge.dx + dz * edge.dz) * 0.3;
    if (!best || score < best.score) {
      best = { edge, lane, s: Math.max(half, Math.min(edge.len - half, s)), score };
    }
  }
  return best;
}
