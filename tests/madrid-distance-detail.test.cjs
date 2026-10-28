const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadModule } = require('./helpers/module.cjs');

test('distance detail restores facades, preserves geometry and monuments, and releases evicted tiles', () => {
  const nearMaterial = {};
  const monumentMaterial = {};
  const geometry = {};
  const facade = { isMesh: true, geometry, material: nearMaterial, userData: {} };
  const monument = { isMesh: true, geometry: {}, material: monumentMaterial, userData: {} };
  const root = { name: 'MadridTile:control', userData: { detailBounds: [-10,-10,10,10] }, parent: {},
    traverse(fn) { fn(facade); fn(monument); } };
  const scene = { traverse(fn) { fn(root); } };
  const { createMadridDistanceDetail } = loadModule(readFileSync(join(__dirname, '../js/madrid-distance-detail.js'), 'utf8'), {
    imports: { 'three/webgpu': { MeshStandardNodeMaterial: class {} },
      './madrid-tiles.js': { MADRID_FACADE_OPTS: [{ stoneColor: 1 }] } }
  });
  const detail = createMadridDistanceDetail([nearMaterial]);
  detail.register(scene);
  detail.update({ x: 0, y: 1200, z: 0 });
  assert.notEqual(facade.material, nearMaterial);
  assert.equal(facade.geometry, geometry);
  assert.equal(monument.material, monumentMaterial);
  const simplified = facade.material;
  detail.update({ x: 0, y: 950, z: 0 });
  assert.equal(facade.material, simplified, 'hysteresis avoids flickering between detail levels');
  detail.update({ x: 0, y: 100, z: 0 });
  assert.equal(facade.material, nearMaterial);
  assert.equal(monument.material, monumentMaterial);
  detail.update({ x: 0, y: 950, z: 0 });
  assert.equal(facade.material, nearMaterial);
  root.parent = null;
  detail.update({ x: 0, y: 1200, z: 0 });
  assert.equal(detail.status().near + detail.status().far, 0);
});
