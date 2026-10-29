const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = readFileSync(join(__dirname, '../js/pedestrian-system.js'), 'utf8');
const production = (name) => source.match(new RegExp(`  function ${name}\\([^]*?\\n  \\}`))[0];

for (const dir of [-1, 1]) {
  test(`a network swap preserves a sidewalk walker moving in direction ${dir}`, () => {
    // New graph objects have the same geometry; reverse directed edges can coexist.
    const forward = { sx: 0, sz: 0, dx: 1, dz: 0, rx: 0, rz: 1, len: 100, half: 4 };
    const reverse = { sx: 100, sz: 0, dx: -1, dz: 0, rx: 0, rz: -1, len: 100, half: 4 };
    const tracks = new Map([forward, reverse].map((edge) => [edge, [{
      ax: edge.sx, az: 5.7, ux: edge.dx, uz: 0, len: 100, edge, node: null
    }]]));
    const context = {
      network: { edges: [forward, reverse] }, pedRoutes: { along: (e) => tracks.get(e) },
      clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x))
    };
    const rematch = vm.runInNewContext(`${production('nearestWalkEdge')}\n${production('rematchSidewalk')}\nrematchSidewalk`, context);
    const ped = { x: 30, z: 5.7, ux: 1, uz: 0, dir, speed: 1.4, v: 1.2, rig: {} };
    assert.equal(rematch(ped), true);
    assert.equal(ped.route, tracks.get(forward)[0]);
    assert.equal(ped.dir, dir);
    assert.equal(ped.t, 30);
    assert.equal(ped.ax + ped.ux * ped.t, ped.x);
    assert.equal(ped.az + ped.uz * ped.t, ped.z);
  });
}
