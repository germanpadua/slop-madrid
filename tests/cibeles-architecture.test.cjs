const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// Geometry records allow spatial assertions without a renderer or external Three.js install.
class Vector { constructor() { this.set(0, 0, 0); } set(x, y, z) { Object.assign(this, { x, y, z }); return this; } }
class Group {
  constructor() { this.children = []; this.position = new Vector(); this.rotation = new Vector(); }
  add(child) { this.children.push(child); }
}
class Mesh extends Group { constructor(geometry, material) { super(); Object.assign(this, { geometry, material }); } }
class Shape {
  constructor() { this.points = []; this.holes = []; }
  moveTo(x, y) { this.points.push([x, y]); }
  lineTo(x, y) { this.points.push([x, y]); }
  absarc() {} closePath() {}
}
class Geometry {
  constructor(...parameters) { this.parameters = parameters; }
  rotateX(angle) { this.rotate = angle; return this; }
  translate(x, y, z) { this.translation = { x, y, z }; return this; }
}
class CylinderGeometry extends Geometry {}
class ConeGeometry extends Geometry {}
class BoxGeometry extends Geometry {}
class ExtrudeGeometry extends Geometry {}
const THREE = { Group, Mesh, Shape, CylinderGeometry, ConeGeometry, BoxGeometry, ExtrudeGeometry,
  MeshStandardNodeMaterial: class { constructor(options) { this.options = options; } } };
const { buildProceduralMonument, buildProceduralColliders } = loadModule(
  readFileSync(join(__dirname, '../js/monuments.js'), 'utf8'), { imports: { 'three/webgpu': THREE } }
);
const source = readFileSync(join(__dirname, '../js/madrid-geodata.js'), 'utf8');
const lm = JSON.parse(source.match(/export const GEO = (.*);/)[1]).landmarks['Palacio de Cibeles'];
const build = () => buildProceduralMonument('Palacio de Cibeles', {}, lm);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function all(group) { return [group, ...group.children.flatMap(all)]; }

function worldPoint(child, parent, root) {
  const { x, y, z } = child.position, angle = parent.rotation.y;
  return { x: lm.cx + root.position.x + parent.position.x + x * Math.cos(angle) + z * Math.sin(angle),
    y: y + parent.position.y, z: lm.cz + root.position.z + parent.position.z - x * Math.sin(angle) + z * Math.cos(angle) };
}

test('Cibeles entrance and both towers face the fountain on the NW frontage', () => {
  const root = build(), front = all(root).find((o) => o.name === 'CibelesNorthwestFrontage');
  assert.ok(front);
  const normal = { x: Math.sin(front.rotation.y), z: Math.cos(front.rotation.y) };
  assert.ok(normal.x < 0 && normal.z < 0, 'facade faces northwest, not west');
  const fountain = { x: 910, z: -276.8 };
  const fx = fountain.x - lm.cx - front.position.x, fz = fountain.z - lm.cz - front.position.z;
  assert.ok((fx * normal.x + fz * normal.z) / Math.hypot(fx, fz) > 0.95);
  const towers = front.children.filter((o) => /Cibeles(North|South)Tower/.test(o.name));
  assert.equal(towers.length, 2);
  const north = worldPoint(towers.find((o) => o.name === 'CibelesNorthTower'), front, root);
  const south = worldPoint(towers.find((o) => o.name === 'CibelesSouthTower'), front, root);
  assert.ok(north.x > south.x && north.z < south.z, 'towers flank a NW diagonal');
  assert.ok(north.z < -260 && south.z < -210, 'tower anchors stay in the NW source lobes');
  assert.ok(front.children.some((o) => o.name === 'CibelesNorthwestEntrance'));
});

test('Cibeles tower galleries remain exposed above their shafts, with narrow visible windows', () => {
  for (const tower of all(build()).filter((o) => /Cibeles(North|South)Tower/.test(o.name))) {
    const shaft = tower.children.find((o) => o.name === 'CibelesTowerShaft');
    const gallery = tower.children.find((o) => o.name === 'CibelesTowerGallery');
    const [topRadius, bottomRadius, height] = shaft.geometry.parameters;
    const galleryHeight = gallery.geometry.parameters[2];
    assert.ok(shaft.position.y + height / 2 <= gallery.position.y - galleryHeight / 2,
      'solid shaft does not bury the gallery');
    const windows = tower.children.filter((o) => o.geometry instanceof BoxGeometry);
    assert.equal(windows.length, 20);
    for (const window of windows) {
      const shaftRadius = bottomRadius + (topRadius - bottomRadius) * window.position.y / height;
      assert.ok(Math.hypot(window.position.x, window.position.z) > shaftRadius * Math.cos(Math.PI / 5),
        'window recess surface sits outside the tapered pentagonal shaft');
      assert.ok(window.geometry.parameters[1] > 3 * window.geometry.parameters[0], 'tall narrow bays');
    }
  }
});

test('Cibeles keeps its source footprint and reaches the documented 70 m with pinnacles, not cone roofs', () => {
  const root = build(), objects = all(root);
  const body = objects.find((o) => o.geometry instanceof ExtrudeGeometry && o.geometry.parameters[1].depth === 28);
  assert.ok(body);
  const points = body.geometry.parameters[0].points;
  assert.equal(points.length, lm.ring.length / 2);
  points.forEach(([x, y], i) => { close(x + lm.cx, lm.ring[i * 2]); close(-y + lm.cz, lm.ring[i * 2 + 1]); });
  const clock = objects.find((o) => o.name === 'CibelesClockTower');
  const pinnacles = clock.children.filter((o) => o.name === 'CibelesClockPinnacle');
  assert.equal(pinnacles.length, 8);
  for (const pinnacle of pinnacles) close(pinnacle.position.y + pinnacle.geometry.parameters[1] / 2, 70);
  assert.ok(objects.filter((o) => o.geometry instanceof ConeGeometry).every((o) => o.geometry.parameters[0] <= 1.4),
    'only slender ornamental pinnacles remain');
  assert.equal(buildProceduralColliders('Palacio de Cibeles', lm)[0].maxY, 70);
});

test('Cibeles clock faces sit below the tall upper gallery and point radially outward', () => {
  const root = build(), tower = all(root).find((o) => o.name === 'CibelesClockTower');
  const front = all(root).find((o) => o.name === 'CibelesNorthwestFrontage');
  const stage = tower.children.find((o) => o.name === 'CibelesClockStage');
  const gallery = tower.children.find((o) => o.name === 'CibelesClockUpperGallery');
  const drum = tower.children.find((o) => o.name === 'CibelesClockLowerDrum');
  const body = all(root).find((o) => o.geometry instanceof ExtrudeGeometry && o.geometry.parameters[1].depth === 28);
  const bodyRoof = body.geometry.translation.y + body.geometry.parameters[1].depth;
  close(drum.position.y - drum.geometry.parameters[2] / 2, bodyRoof);
  close(drum.position.y + drum.geometry.parameters[2] / 2, stage.position.y - stage.geometry.parameters[2] / 2);
  const galleryBottom = gallery.position.y - gallery.geometry.parameters[2] / 2;
  assert.ok(stage.position.y + stage.geometry.parameters[2] / 2 <= galleryBottom);
  close(tower.rotation.y, front.rotation.y);
  const faces = tower.children.filter((o) => o.name === 'CibelesClockFace');
  const dials = tower.children.filter((o) => o.name === 'CibelesClockDial');
  assert.equal(faces.length, 4);
  assert.equal(dials.length, 4);
  for (const disk of [...faces, ...dials]) {
    assert.ok(disk.position.y + disk.geometry.parameters[0] <= galleryBottom,
      'whole clock disk remains below the open upper gallery');
    // Apply Euler XYZ to the cylinder cap's local +Y normal (Z, then Y, then X).
    const { x, y, z } = disk.rotation;
    const afterZ = [-Math.sin(z), Math.cos(z), 0];
    const afterY = [afterZ[0] * Math.cos(y), afterZ[1], -afterZ[0] * Math.sin(y)];
    const normal = [afterY[0], afterY[1] * Math.cos(x) - afterY[2] * Math.sin(x),
      afterY[1] * Math.sin(x) + afterY[2] * Math.cos(x)];
    const radial = Math.hypot(disk.position.x, disk.position.z);
    close(normal[0], disk.position.x / radial);
    close(normal[1], 0);
    close(normal[2], disk.position.z / radial);
  }
});
