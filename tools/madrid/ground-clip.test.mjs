// tools/madrid/ground-clip.test.mjs — regression tests for TileRoadRibbons geometry (js/madrid-ground-clip.js).
// Covers the combinations screenshots cannot: proper crossing, boundary graze, water-covered, nested/overlapping
// rings, joined turns, and the non-convex midpoint trap. Run: node tools/madrid/ground-clip.test.mjs
import { clipRoadToRings, pointInRing, ringBBox } from '../../js/madrid-ground-clip.js';

let failed = 0;
const ok = (cond, name) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); if (!cond) failed++; };
const sq = (cx, cz, s) => { const h = s / 2; return [{ x: cx - h, z: cz - h }, { x: cx + h, z: cz - h }, { x: cx + h, z: cz + h }, { x: cx - h, z: cz + h }]; };
const ring = (r) => ({ ring: r, bb: ringBBox(r) });
const len = (p) => Math.hypot(p.b.x - p.a.x, p.b.z - p.a.z);

// 1. proper crossing: straight road through a 100x100 square -> one piece, endpoints ON the boundary
{
  const { pieces } = clipRoadToRings([{ x: -100, z: 0 }, { x: 100, z: 0 }], [ring(sq(0, 0, 100))]);
  ok(pieces.length === 1, 'crossing: one piece');
  ok(pieces.length && Math.abs(pieces[0].a.x + 50) < 1e-6 && Math.abs(pieces[0].b.x - 50) < 1e-6, 'crossing: split exactly at boundary');
  ok(pieces.length && Math.abs(len(pieces[0]) - 100) < 1e-6, 'crossing: piece length = chord');
}
// 2. boundary graze: road fully outside, touching the edge -> no pieces
{
  const { pieces } = clipRoadToRings([{ x: -100, z: 50 }, { x: 100, z: 50 }], [ring(sq(0, 0, 100))]);
  ok(pieces.length === 0, 'boundary: edge-touching outside road yields nothing');
}
// 3. water: inWater covers the ring centre -> piece dropped
{
  const { pieces } = clipRoadToRings([{ x: -100, z: 0 }, { x: 100, z: 0 }], [ring(sq(0, 0, 100))], { inWater: () => true });
  ok(pieces.length === 0, 'water: water-covered piece skipped');
}
// 4. nested rings: inner grass ring inside outer park ring -> stretch emitted once
{
  const { pieces } = clipRoadToRings([{ x: -100, z: 0 }, { x: 100, z: 0 }], [ring(sq(0, 0, 100)), ring(sq(0, 0, 60))]);
  ok(pieces.length === 1, 'nested: overlapping rings emit once');
}
// 5. joint: right-angle turn inside the ring -> joint at the corner vertex
{
  const { pieces, joints } = clipRoadToRings([{ x: -100, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 40 }], [ring(sq(0, 0, 100))]);
  ok(pieces.length === 2, 'joint: two kept pieces');
  ok(joints.length === 1 && Math.abs(joints[0].x) < 1e-9 && Math.abs(joints[0].z) < 1e-9, 'joint: cap at the turn vertex');
}
// 6. non-convex midpoint trap: U-shaped ring; segment with both ends inside, middle outside -> TWO pieces
{
  const u = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }, { x: 60, z: 100 }, { x: 60, z: 40 }, { x: 40, z: 40 }, { x: 40, z: 100 }, { x: 0, z: 100 }];
  // road at z=70 crosses the bay (40<x<60 is outside the ring)
  const { pieces } = clipRoadToRings([{ x: -10, z: 70 }, { x: 110, z: 70 }], [ring(u)]);
  ok(pieces.length === 2, 'midpoint-trap: ends-inside/middle-outside splits into two pieces');
  ok(pieces.length === 2 && pieces.every((p) => p.b.x - p.a.x > 0), 'midpoint-trap: pieces ordered');
  const mids = pieces.map((p) => (p.a.x + p.b.x) / 2);
  ok(mids.length === 2 && mids[0] < 40 && mids[1] > 60, 'midpoint-trap: bay (40..60) not covered');
}
// 7. sliver: crossing a corner leaves a sub-minLen piece -> dropped
{
  const { pieces } = clipRoadToRings([{ x: 49.5, z: 40 }, { x: 60, z: 60 }], [ring(sq(0, 0, 100))]); // in-ring chord ~1.1 m < minLen
  ok(pieces.length === 0, 'sliver: sub-minLen corner clip dropped');
}
// 8. sanity: pointInRing / ringBBox
{
  ok(pointInRing(sq(0, 0, 100), 0, 0) && !pointInRing(sq(0, 0, 100), 60, 0), 'pointInRing basics');
}
process.exit(failed ? 1 : 0);
