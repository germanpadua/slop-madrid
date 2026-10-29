// Pure CPU preparation, also usable without Worker support.
import { decomposeRing } from './madrid-footprint.js';
import { partyWallHeights, partyWallRuns } from './madrid-adjacency.js';
import { tileRoofInstances } from './madrid-roofs.js';
import { buildFarBuildings } from './madrid-far-buildings.js';

export function prepareTile(data) {
  const t0 = performance.now();
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
  const tH = performance.now();
  const heights = partyWallHeights(parcels);
  const tR = performance.now();
  const roofs = tileRoofInstances(parcels);
  const tW = performance.now();
  const runs = partyWallRuns(parcels);
  const stageMs = { decompose: Math.round(tH - t0), heights: Math.round(tR - tH), roofs: Math.round(tW - tR), runs: Math.round(performance.now() - tW) };
  return { footprints, farBuildings: data.distanceGeometry ? buildFarBuildings(parcels, heights) : null, roofs, indices: parcels.map((p) => p.index), heights, runs, stageMs };
}
