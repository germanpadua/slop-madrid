// Pure CPU preparation, also usable without Worker support.
import { decomposeRing } from './madrid-footprint.js';
import { partyWallHeights, partyWallRuns } from './madrid-adjacency.js';
import { tileRoofInstances } from './madrid-roofs.js';

export function prepareTile(data) {
  const footprints = [];
  const parcels = [];
  for (const [index, p] of (data.parcels || []).entries()) {
    if (!p.ring || p.ring.length < 6 || !(p.h > 0)) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i + 1 < p.ring.length; i += 2) {
      x0 = Math.min(x0, p.ring[i]); x1 = Math.max(x1, p.ring[i]);
      z0 = Math.min(z0, p.ring[i + 1]); z1 = Math.max(z1, p.ring[i + 1]);
    }
    if (x1 - x0 < 2 || z1 - z0 < 2) continue;
    footprints[index] = decomposeRing(p.ring, { stripW: 4, minD: 0.4, holes: p.holes || [] });
    parcels.push({ ...p, index, x0, x1, z0, z1, w: x1 - x0, d: z1 - z0, fp: footprints[index].deviation <= 0.10 ? footprints[index] : null });
  }
  return { footprints, roofs: tileRoofInstances(parcels), indices: parcels.map((p) => p.index), heights: partyWallHeights(parcels), runs: partyWallRuns(parcels) };
}
