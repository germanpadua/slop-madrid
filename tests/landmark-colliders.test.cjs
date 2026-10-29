const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = readFileSync(join(__dirname, '../js/landmarks.js'), 'utf8');
const build = source.match(/function buildLandmarks\([^]*?\n\}/)[0];

test('flat fountain and plaza footprints do not retain invisible raised collision boxes', () => {
  class Group {
    constructor() { this.children = []; this.position = { set() {} }; }
    add(child) { this.children.push(child); }
  }
  class Shape { moveTo() {} lineTo() {} closePath() {} }
  class Geometry { rotateX() { return this; } translate() { return this; } }
  class Mesh { constructor(geometry) { this.geometry = geometry; } }
  const footprint = { cx: 0, cz: 0, w: 26, d: 18, h: 8, ring: [-13,-9,13,-9,13,9,-13,9] };
  const buildLandmarks = vm.runInNewContext(`(${build})`, {
    THREE: { Group, Shape, ShapeGeometry: Geometry, Mesh, MeshStandardNodeMaterial: class {} },
    LANDMARK_SITES: { 'Fuente de Cibeles': footprint, 'Plaza de prueba': footprint },
    MADRID_LANDMARK_STYLES: [], DEFAULT_LANDMARK_BODY: {},
    createLandmarkFacadeMaterial: () => ({}), batchStaticGroupMeshes() {}
  });
  const scene = new Group();
  const result = buildLandmarks(scene);
  assert.equal(result.group.children.length, 2, 'both source footprints still render');
  assert.equal(result.colliders.length, 0, 'pavement has no nine metre obstacle');
  assert.equal(scene.children[0], result.group);
});
