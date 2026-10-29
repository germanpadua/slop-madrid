const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const root = join(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'tools/madrid/tiles.json')));

test('merged manifest totals count the actual union, including seed block bytes', () => {
  const ready = manifest.tiles.filter((t) => t.status === 'ready');
  assert.equal(manifest.tiles.length, new Set(manifest.tiles.map((t) => t.id)).size);
  assert.equal(manifest.totals.tiles, manifest.tiles.length);
  for (const status of ['ready', 'pending', 'failed']) {
    assert.equal(manifest.totals[status], manifest.tiles.filter((t) => t.status === status).length);
  }
  assert.equal(manifest.totals.readyBytes, ready.reduce((n, t) => n + (t.bytes || 0) + (t.blocksBytes || 0), 0));
  assert.equal(manifest.totals.readyKm2, +ready.reduce((n, t) => n + t.areaKm2, 0).toFixed(3));
  assert.equal(ready.length, 19);
  assert.equal(manifest.generated, '2026-10-29');
});

test('shared regenerated cells retain the facade/roof wave hashes', () => {
  const hashes = {
    'k1j-1': '5e9f677a390639cbdb5afb16d039cdaa',
    'k3j-1': '0231ad0a93bef5408d1d8df0169178f6',
    k3j0: 'e8f7e0f113d3301a126abf48f356e643',
    k4j0: 'e8c42f3e04df4aa1127d45673f2a0c24'
  };
  for (const [id, hash] of Object.entries(hashes)) assert.equal(manifest.tiles.find((t) => t.id === id).md5, hash, id);
});

test('all ten monument modules own their volumes ahead of procedural monuments and generic extrusions', async () => {
  const sites = await import('../js/monument-sites.js');
  const monuments = JSON.parse(readFileSync(join(root, 'tools/madrid/monumentos.json')));
  const lm = { ring: [0, 0, 20, 0, 20, 20, 0, 20], w: 20, h: 30 };
  assert.deepEqual(Object.keys(sites.MONUMENT_MESH_SITES).sort(), monuments.monuments.map((m) => m.id).sort());
  for (const name of sites.MONUMENT_SITE_NAMES) {
    assert.equal(sites.hasProceduralMonument(name), false, name);
    assert.deepEqual(sites.landmarkExtrusions({ [name]: lm }), [], name);
  }
  assert.equal(sites.hasProceduralMonument('Puerta de Alcalá'), false);
  assert.equal(sites.hasProceduralMonument('Fuente de Cibeles'), false);
  assert.equal(sites.hasProceduralMonument('Palacio de Cibeles'), true, 'palace and fountain are different sites');
});

test('all origin open-space categories stay pavement even with a tagged height', async () => {
  const { OPEN_SPACE, landmarkExtrusions } = await import('../js/monument-sites.js');
  for (const name of ['Plaza Mayor', 'Glorieta de Bilbao', 'Parque del Retiro', 'Jardín de prueba', 'Jardines de prueba',
    'Paseo de prueba', 'Campo de prueba', 'Cuesta de prueba', 'Puerta del Sol']) {
    assert.ok(OPEN_SPACE.test(name), name);
    assert.deepEqual(landmarkExtrusions({ [name]: { ring: [0, 0, 20, 0, 20, 20], w: 20, h: 24 } }), [], name);
  }
});

const parcel = (x0, z0, x1, z1, h) => ({ x0, z0, x1, z1, h, ring: [x0, z0, x1, z0, x1, z1, x0, z1] });
test('ring-based party walls find abutters across spatial bins but leave separated and corner-only parcels alone', async () => {
  const { partyWallHeights } = await import('../js/madrid-adjacency.js');
  const a = parcel(54, 54, 64, 64, 20), b = parcel(64, 54, 74, 64, 12);
  assert.deepEqual(partyWallHeights([a, b]), [[0, 12, 0, 0], [20, 0, 0, 0]]);
  const far = parcel(67, 54, 77, 64, 12), corner = parcel(64, 64, 74, 74, 12);
  assert.deepEqual(partyWallHeights([a, far, corner]), [[0, 0, 0, 0], [0, 0, 0, 12], [0, 0, 12, 0]]);
});
