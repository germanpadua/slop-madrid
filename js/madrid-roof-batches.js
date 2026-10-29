// Roofs are part of the city's silhouette, not furniture streamed around the player.
// Reuse the seed's existing illustrated roof decisions; do not generate additional roofs.
export function collectRoofBatches(blocks, cellSize = 512) {
  const cells = new Map();
  for (const block of blocks) {
    for (const roof of block.hipRoofs || []) {
      const key = `${Math.floor(roof.x / cellSize)},${Math.floor(roof.z / cellSize)},${roof.ring ? 'ring' : 'hip'}`;
      if (!cells.has(key)) cells.set(key, { key, ring: Boolean(roof.ring), roofs: [] });
      cells.get(key).roofs.push({
        x: roof.x, y: roof.y, z: roof.z,
        yaw: (block.ry || 0) + roof.rot,
        width: (roof.rot ? roof.d : roof.w) + 0.6,
        depth: (roof.rot ? roof.w : roof.d) + 0.6,
        height: roof.h,
        ci: roof.ci, slate: roof.slate
      });
    }
  }
  return [...cells.values()];
}
