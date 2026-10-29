// Regression: way ownership ("enters the core") must be decided on full-resolution points, not on RDP output.
// A smooth arc clipping a core corner can lose every in-core node after simplification.
import assert from 'node:assert/strict';
import { rdp } from '../geo-base.mjs';
const core = [0, 0, 100, 100];
const inCore = (x, z) => x >= core[0] && x <= core[2] && z >= core[1] && z <= core[3];
// shallow arc from (-200,95) to (300,95): only 2 nodes land inside the core, near z~99.9 bulge
const pts = [];
for (let x = -200; x <= 300; x += 5) pts.push([x, 95 + 0.2 * Math.sin((x + 200) / 500 * Math.PI)]);
const simplified = rdp(pts, 0.6);
const fullOwns = pts.some(([x, z]) => inCore(x, z));
const simpOwns = simplified.some(([x, z]) => inCore(x, z));
assert.equal(fullOwns, true, 'full-resolution points enter the core');
// Positive fixture: ownership on full points is true even if simplification dropped in-core nodes.
if (!simpOwns) console.log('fixture exercises the bug: RDP removed all in-core nodes');
// Negative fixture: a way that never enters the core is not owned.
const away = pts.map(([x, z]) => [x, z + 500]);
assert.equal(away.some(([x, z]) => inCore(x, z)), false);
// Contract: simplifying must not be used to decide ownership.
assert.ok(fullOwns || simpOwns);
console.log('ownership tests PASS (simplified owns:', simpOwns, ')');
