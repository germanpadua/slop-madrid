// tools/madrid/ground-clip.test.mjs — regression tests for TileRoadRibbons geometry (js/madrid-ground-clip.js).
// Covers the combinations screenshots cannot: proper crossing, boundary graze, water-covered, nested/overlapping
// rings, joined turns, and the non-convex midpoint trap. Run: node tools/madrid/ground-clip.test.mjs
import { clipRoadToRings, pointInRing, pointInWaterBoxes, ringBBox, ringsContained, ringsCross, segPointDist } from '../../js/madrid-ground-clip.js';

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

// 7. ringsContained: lawn hole cutting for stacked ground layers (tan-patch fix)
{
  const outer = ring(sq(0, 0, 100));
  const inside = ring(sq(0, 0, 40));
  const disjoint = ring(sq(200, 0, 40));
  const crossing = ring(sq(50, 0, 40)); // straddles the boundary
  const touching = [{ x: -20, z: -20 }, { x: 50, z: -20 }, { x: 50, z: 20 }, { x: -20, z: 20 }]; // vertex ON boundary
  const got = ringsContained(outer.ring, outer.bb, [inside, disjoint, crossing, ring(touching)]);
  ok(got.length === 1 && got[0] === inside, 'contained: only the fully-inside ring is a hole');
}
// 8. ringsContained non-convex: candidate with all vertices inside but an edge crossing the outer boundary
{
  const c = [{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 40 }, { x: 20, z: 20 }, { x: 0, z: 40 }]; // concave notch at (20,20)
  const outer = ring(c);
  const sneaky = [{ x: 30, z: 25 }, { x: 50, z: 25 }, { x: 30, z: 5 }]; // vertices inside, edge through the notch mouth
  // if any candidate edge crosses the outer boundary it must be rejected even with every vertex inside
  const got = ringsContained(outer.ring, outer.bb, [ring(sneaky)]);
  const crosses = ringsCross(c, sneaky);
  ok(crosses ? got.length === 0 : true, 'contained: edge-crossing candidate rejected (or no crossing, vacuous)');
  ok(ringsCross(c, [{ x: -10, z: 20 }, { x: 60, z: 20 }, { x: 25, z: 30 }]) === true, 'ringsCross: detects a proper crossing');
  ok(ringsCross(sq(0, 0, 100), sq(200, 0, 40)) === false, 'ringsCross: disjoint rings do not cross');
}
// 9. ringsContained self/nested: a big candidate fully swallowing the outer ring is NOT a hole
{
  const outer = ring(sq(0, 0, 40));
  const bigger = ring(sq(0, 0, 100));
  ok(ringsContained(outer.ring, outer.bb, [bigger]).length === 0, 'contained: swallowing ring rejected by bbox gate');
}



// 10. obstacles: perpendicular road band crossing splits the piece, only the in-band sub-piece drops (no gaps)
{
  const R = ring(sq(0, 0, 400));
  const road = { a: { x: -30, z: 0 }, b: { x: 30, z: 0 }, wHalf: 5 };
  const { pieces } = clipRoadToRings([{ x: 0, z: -100 }, { x: 0, z: 100 }], [R], { obstacles: [road], selfHalf: 1, minLen: 0.5 });
  ok(pieces.length === 2, 'obstacle: crossing splits into two kept ends');
  const ends = pieces.flatMap((p) => [p.a.z, p.b.z]).sort((x, y) => x - y);
  ok(pieces.length === 2 && Math.abs(ends[0] + 100) < 1e-6 && Math.abs(ends[1] + 6) < 1e-3 && Math.abs(ends[2] - 6) < 1e-3 && Math.abs(ends[3] - 100) < 1e-6,
    'obstacle: cut exactly at the band boundary (wHalf+selfHalf=6), no whole-piece gap');
}
// 11. obstacles: path running along inside the band is dropped entirely; outside the band untouched
{
  const R = ring(sq(0, 0, 400));
  const road = { a: { x: -50, z: 0 }, b: { x: 50, z: 0 }, wHalf: 5 };
  const inside = clipRoadToRings([{ x: -40, z: 2 }, { x: 40, z: 2 }], [R], { obstacles: [road], selfHalf: 1, minLen: 0.5 });
  ok(inside.pieces.length === 0, 'obstacle: parallel inside band dropped');
  const outside = clipRoadToRings([{ x: -40, z: 20 }, { x: 40, z: 20 }], [R], { obstacles: [road], selfHalf: 1, minLen: 0.5 });
  ok(outside.pieces.length === 1, 'obstacle: parallel outside band kept');
}
// 12. obstacles: endpoint (cap) region - path crossing near the obstacle endpoint still cuts at the circle
{
  const R = ring(sq(0, 0, 400));
  const road = { a: { x: 0, z: 0 }, b: { x: 30, z: 0 }, wHalf: 5 };
  const { pieces } = clipRoadToRings([{ x: -2, z: -50 }, { x: -2, z: 50 }], [R], { obstacles: [road], selfHalf: 1, minLen: 0.5 });
  ok(pieces.length === 2, 'obstacle: crossing near endpoint splits via the cap circle');
  const gap = pieces.length === 2 ? pieces[0].b.z : 0;
  ok(pieces.length === 2 && Math.abs(Math.hypot(-2 - 0, gap - 0) - 6) < 1e-3, 'obstacle: cap cut at radius wHalf+selfHalf');
}
// 13. pointInWaterBoxes fixtures (guard for the object-bb predicate that silently never fired)
{
  const box = (ringPts) => ({ ring: ringPts, bb: { x0: Math.min(...ringPts.map((p) => p.x)), z0: Math.min(...ringPts.map((p) => p.z)), x1: Math.max(...ringPts.map((p) => p.x)), z1: Math.max(...ringPts.map((p) => p.z)) } });
  const lshape = [{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 40 }, { x: 20, z: 40 }, { x: 20, z: 20 }, { x: 0, z: 20 }]; // notch at x<20,z>20
  const boxes = [box(lshape)];
  ok(pointInWaterBoxes(boxes, 30, 30) === true, 'water: inside ring -> true (positive fixture)');
  ok(pointInWaterBoxes(boxes, 10, 30) === false, 'water: inside bbox but in the notch -> false (negative fixture)');
  ok(pointInWaterBoxes(boxes, 100, 100) === false, 'water: outside bbox -> false');
  ok(pointInWaterBoxes([], 10, 10) === false, 'water: no boxes -> false');
  ok(segPointDist({ x: 0, z: 5 }, { x: -10, z: 0 }, { x: 10, z: 0 }) === 5, 'segPointDist: perpendicular distance');
}

process.exit(failed ? 1 : 0);