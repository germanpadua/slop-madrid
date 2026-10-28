const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

test('spatial medianera lookup preserves the pre-optimization real tile results', async () => {
  const { TILE } = await import('../js/geodata/tile-k3j0.js');
  const { partyWallHeights, partyWallRuns } = await import('../js/madrid-adjacency.js');
  const parcels = TILE.parcels.map(p => {
    const xs = p.ring.filter((_, i) => i % 2 === 0), zs = p.ring.filter((_, i) => i % 2 === 1);
    return { ...p, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  });
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  // Generated with the exhaustive search in 77921de, all 1160 cadastral parcels.
  assert.equal(hash(partyWallHeights(parcels)), '7a4feec83c548e914b969d32cd15ef6923bf411dd7b89cde9f88d520dff8f0a3');
  assert.equal(hash(partyWallRuns(parcels)), '01d0f68ce942281fe95d6ece63b3905999a6b43131514e781e21f245f13ea2cd');
});

