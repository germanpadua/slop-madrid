import * as THREE from 'three/webgpu';
import { CROSSWALK } from './road-network.js';
import { createRoadPaintMaterial } from './tsl-materials.js';

// js/road-paint.js
// Road markings generated from the drivable road network (js/road-network.js), so the paint matches where traffic
// actually drives and stops: dashed lane lines, double yellow centre lines on two-way roads, stop bars at the stop
// lines, continental crosswalks across every intersection approach and green bike lanes along wide one-way avenues.
//
// The resident network (js/madrid-road-network.js) is swapped every time a tile loads or unloads, so the markings
// have to follow it. `createRoadPaint(scene)` owns one group/mesh/material and `rebuild(network)` replaces its
// geometry in place: previous geometry is disposed, the material is reused (no shader recompile) and no second
// group is ever added to the scene. `buildRoadPaint(scene, network)` keeps the original one-shot contract for
// js/main.js and is adopted by the controller if it already ran.

const WHITE = new THREE.Color(0xe6e2d6);
const YELLOW = new THREE.Color(0xe8ad22);
const GREEN = new THREE.Color(0x2a8a4e);
const HEIGHT = 0.012; // above the asphalt

// The worker-decoded resident network carries `paintEdges: []` (decodeRoadNetwork), and an empty array is
// truthy: prefer paintEdges only when it actually has edges, otherwise fall back to the routing edges.
function paintSource(network) {
  if (!network) return [];
  const edges = network.paintEdges && network.paintEdges.length ? network.paintEdges : network.edges;
  return Array.isArray(edges) ? edges : [];
}

// Builder nodes carry the `shape` flag (a centreline bend, not an intersection); worker-decoded nodes drop it.
// Reconstruct it from the two lead arms exactly like buildRoadNetwork does, so resident bends suppress their
// crosswalks and join their dashes instead of painting an intersection that is not there.
function isShape(node) {
  if (!node) return false;
  if (node.shape !== undefined) return !!node.shape;
  if (!node.general || !Array.isArray(node.arms) || node.arms.length < 2) return false;
  const leads = node.arms.filter((a) => !a || a.lead === undefined || a.lead === a);
  if (leads.length !== 2 || !leads[0] || !leads[1]) return false;
  // Same fork test as buildRoadNetwork: a road splitting in two live arms within 20° is an intersection, not a bend.
  const live = (a) => !!((a.in && a.in.live) || (a.out && a.out.live));
  if (leads.some((lead) => node.arms.filter((a) => a.lead === lead && live(a)).length > 1)) return false;
  return leads[0].ux * leads[1].ux + leads[0].uz * leads[1].uz < -0.82;
}

// Tolerate a partially populated network (the worker answer may race a tile eviction): an edge that cannot describe
// a strip is skipped instead of throwing and leaving the street unmarked.
function usableEdge(e) {
  return !!e && !!e.from && !!e.to && Array.isArray(e.lanes) && e.lanes.length > 0 &&
    Number.isFinite(e.dx) && Number.isFinite(e.dz) && Number.isFinite(e.len) && Number.isFinite(e.half);
}

function buildPaintMesh(network, material) {
  const position = [];
  const side = [];
  const paint = [];
  const colors = [];
  const index = [];
  const lines = [];
  const bends = new Map();

  // Flat strip w wide from a to b, with a dash pattern (period, duty cycle) running along it
  function strip(ax, az, bx, bz, w, col, period = 1, duty = 1, phase = 0, flow = 1) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) return;
    const sx = ((az - bz) / len) * w * 0.5;
    const sz = ((bx - ax) / len) * w * 0.5;
    const i = position.length / 3;
    const end = phase + len * flow;
    for (const [x, z, s, u] of [[ax, az, -1, phase], [ax, az, 1, phase], [bx, bz, 1, end], [bx, bz, -1, end]]) {
      position.push(x + sx * s, HEIGHT, z + sz * s);
      side.push(sx * s, sz * s);
      paint.push(u, period, duty);
      colors.push(col.r, col.g, col.b);
    }
    index.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  // Edges run between stop lines; s is measured from the start one and o to the right of the centre line
  const at = (e, s, o) => [e.sx + e.dx * s + e.rx * o, e.sz + e.dz * s + e.rz * o];
  const along = (e, o, w, col, period = 1, duty = 1) => {
    const start = (e.sx - e.x0) * e.dx + (e.sz - e.z0) * e.dz;
    const ends = [at(e, isShape(e.from) ? -start : 0.9, o), at(e, isShape(e.to) ? e.span - start : e.len - 0.9, o)];
    lines.push({ e, o, w, col, period, duty, ends, joins: [] });
  };
  const across = (e, s, o0, o1, w, col, period, duty) => strip(...at(e, s, o0), ...at(e, s, o1), w, col, period, duty);
  const clearCentre = (e, o) => {
    if (!network || !network.isRoadClear) return false;
    const steps = Math.max(1, Math.ceil((e.len - 1.8) / 2.5));
    for (let i = 0; i <= steps; i++) {
      const s = 0.9 + (e.len - 1.8) * i / steps;
      for (const offset of [o - 0.12, o + 0.12]) if (!network.isRoadClear(...at(e, s, offset), 0.15)) return false;
    }
    return true;
  };

  // The one or two directed edges of each road between a pair of intersections
  const roads = new Map();
  for (const e of paintSource(network)) {
    if (!usableEdge(e)) continue;
    const key = Math.min(e.from.id, e.to.id) * 65536 + Math.max(e.from.id, e.to.id);
    if (roads.has(key)) roads.get(key).push(e);
    else roads.set(key, [e]);
  }

  for (const group of roads.values()) {
    const e = group[0];
    // Pair the road with its oncoming edge when the network says which one it is; otherwise keep the old
    // "second edge of the pair" fallback.
    const back = group.find((c) => c !== e && c.from === e.to && c.to === e.from) || group[1] || null;
    const firstLine = lines.length;
    // Lanes of both directions, measured to the right of e, left to right
    const lanes = e.lanes.map((o) => ({ o, dir: 1 }));
    if (back) for (const o of back.lanes) lanes.push({ o: -o, dir: -1 });
    lanes.sort((p, q) => p.o - q.o);

    // Dashed white between lanes going the same way, double yellow between opposing ones
    // (nothing across a median or a lane closed off by an obstacle)
    for (let k = 0; k + 1 < lanes.length; k++) {
      const p = lanes[k];
      const q = lanes[k + 1];
      const mid = (p.o + q.o) / 2;
      if (q.o - p.o > 4.5 && (p.dir === q.dir || !clearCentre(e, mid))) continue;
      if (p.dir === q.dir) {
        along(e, mid, 0.13, WHITE, 12, 0.25);
      } else {
        along(e, mid - 0.12, 0.11, YELLOW);
        along(e, mid + 0.12, 0.11, YELLOW);
      }
    }

    // Wide one-way avenues: edge line, then a buffer and a green bike lane along the curb on the side left free
    if (!back && e.axis === 'ave' && lanes.length >= 4) {
      for (const [edge, sign] of [[lanes[lanes.length - 1].o + 1.8, 1], [lanes[0].o - 1.8, -1]]) {
        const curb = sign * e.half;
        if ((curb - edge) * sign < 3.5) continue;
        along(e, edge + sign * 0.2, 0.13, WHITE);
        along(e, curb - sign * 2.4, 0.13, WHITE);
        along(e, curb - sign * 1.3, 2.0, GREEN);
      }
    }

    // Stop bars across the lanes arriving at each stop line, from the centre line (or median) to the curb (none where a
    // street merely bends: a shape node of the centreline streets)
    for (const f of back ? [e, back] : [e]) {
      if (isShape(f.to)) continue;
      const left = back ? Math.max(0, f.lanes[0] - 1.8) : -f.half;
      across(f, f.len - 0.35, left + 0.1, f.half - 0.1, 0.45, WHITE);
    }

    // Continental crosswalks curb to curb, between the stop lines and the intersections at both ends
    if (!isShape(e.from)) across(e, -CROSSWALK / 2, -e.half, e.half, CROSSWALK - 0.3, WHITE, 1.2, 0.5);
    if (!isShape(e.to)) across(e, e.len + CROSSWALK / 2, -e.half, e.half, CROSSWALK - 0.3, WHITE, 1.2, 0.5);

    for (const [end, node] of [[0, e.from], [1, e.to]]) {
      if (!isShape(node)) continue;
      if (!bends.has(node.id)) bends.set(node.id, []);
      bends.get(node.id).push({ e, end, lines: lines.slice(firstLine) });
    }
  }

  // At a simple bend, corresponding offset lines meet at a bounded miter, without an intersection-sized gap.
  for (const roadsAtBend of bends.values()) {
    if (roadsAtBend.length !== 2) continue;
    const [a, b] = roadsAtBend;
    const sign = a.end === b.end ? -1 : 1;
    if ((a.e.dx * b.e.dx + a.e.dz * b.e.dz) * sign < 0.5) continue;
    for (const p of a.lines) {
      let q = null;
      let distance = 0.5;
      for (const line of b.lines) {
        const d = Math.abs(p.o - line.o * sign);
        if (!line.joins[b.end] && line.col === p.col && line.w === p.w && line.period === p.period &&
          line.duty === p.duty && d < distance) {
          q = line;
          distance = d;
        }
      }
      if (!q) continue;
      const A = p.ends[a.end];
      const B = q.ends[b.end];
      const dx = B[0] - A[0];
      const dz = B[1] - A[1];
      const cross = a.e.dx * b.e.dz - a.e.dz * b.e.dx;
      let join;
      if (Math.abs(cross) < 0.001) {
        if (Math.hypot(dx, dz) > 0.5) continue;
        join = [(A[0] + B[0]) * 0.5, (A[1] + B[1]) * 0.5];
      } else {
        const t = (dx * b.e.dz - dz * b.e.dx) / cross;
        const u = (dx * a.e.dz - dz * a.e.dx) / cross;
        const limit = Math.min(6, a.e.span * 0.25, b.e.span * 0.25);
        if (Math.abs(t) > limit || Math.abs(u) > limit) continue;
        join = [A[0] + a.e.dx * t, A[1] + a.e.dz * t];
      }
      p.ends[a.end] = q.ends[b.end] = join;
      p.joins[a.end] = [q, b.end];
      q.joins[b.end] = [p, a.end];
    }
  }

  // Continue the same dash phase around bends, even when adjacent road edges point in opposite directions.
  for (const line of lines) {
    // An unmatched marking keeps its original gap instead of extending towards a curb at a sharp bend.
    for (const end of [0, 1]) {
      if (!line.joins[end]) line.ends[end] = at(line.e, end ? line.e.len - 0.9 : 0.9, line.o);
    }
    line.len = Math.hypot(line.ends[1][0] - line.ends[0][0], line.ends[1][1] - line.ends[0][1]);
  }
  for (const root of lines) {
    if (root.phase !== undefined) continue;
    root.phase = 0;
    root.flow = 1;
    const stack = [root];
    while (stack.length) {
      const line = stack.pop();
      for (let end = 0; end < 2; end++) {
        if (!line.joins[end]) continue;
        const [next, nextEnd] = line.joins[end];
        if (next.phase !== undefined) continue;
        next.flow = line.flow * (end === nextEnd ? -1 : 1);
        next.phase = line.phase + end * line.len * line.flow - nextEnd * next.len * next.flow;
        next.phase = ((next.phase % next.period) + next.period) % next.period;
        stack.push(next);
      }
      strip(...line.ends[0], ...line.ends[1], line.w, line.col, line.period, line.duty, line.phase, line.flow);
    }
  }

  const normal = new Float32Array(position.length);
  for (let i = 1; i < normal.length; i += 3) normal[i] = 1;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('side', new THREE.Float32BufferAttribute(side, 2));
  geometry.setAttribute('paint', new THREE.Float32BufferAttribute(paint, 3));
  geometry.setIndex(index);

  const mesh = new THREE.Mesh(geometry, material || createRoadPaintMaterial());
  mesh.name = 'RoadMarkings';
  mesh.userData.roadPaint = true;
  mesh.receiveShadow = true;
  mesh.renderOrder = -1; // under the other see-through ground effects (contact shadows, headlight beams)
  return mesh;
}

// One-shot API kept for js/main.js: builds the markings for the network it is given and adds them to the scene.
function buildRoadPaint(scene, network) {
  const mesh = buildPaintMesh(network, createRoadPaintMaterial());
  scene.add(mesh);
  return mesh;
}

// Rebuildable painter used by the resident network. It owns a single group/material and swaps only the geometry,
// so a tile load/unload cannot leak markings or stack duplicate groups in the scene.
// Integration (Lead, js/main.js): after `buildRoadPaint(...)` create the controller (it adopts the boot mesh),
// call `roadPaint.rebuild(network)` inside roadService's onNetwork, and `roadPaint.dispose()` on pagehide.
function createRoadPaint(scene, network) {
  const group = new THREE.Group();
  group.name = 'RoadPaint';
  group.userData.roadPaint = true;

  let mesh = null;
  let material = null;
  let source = null;
  let disposed = false;
  let warned = false;

  // Take over the mesh buildRoadPaint already added at boot, so switching to this controller does not leave
  // two marking meshes (or two groups) in the scene.
  for (const child of scene.children.slice()) {
    if (!child || child.userData?.roadPaint !== true || !child.geometry) continue;
    scene.remove(child);
    group.add(child);
    scene.add(group);
    mesh = child;
    material = child.material;
    break;
  }

  function release() {
    if (!mesh) return;
    if (mesh.parent) mesh.parent.remove(mesh);
    mesh.geometry?.dispose?.();
    mesh = null;
  }

  function rebuild(nextNetwork) {
    if (disposed) return null;
    if (!nextNetwork) {
      release();
      source = null;
      return null;
    }
    if (nextNetwork === source && mesh) return mesh;
    if (!paintSource(nextNetwork).length) {
      release();
      source = nextNetwork;
      warned = false;
      return null;
    }
    if (!material) material = createRoadPaintMaterial();
    let next = null;
    try {
      next = buildPaintMesh(nextNetwork, material);
    } catch (error) {
      // Keep the previous markings on screen rather than leaving the street blank on a malformed swap.
      if (!warned) console.warn('[road-paint] resident network paint skipped:', error.message);
      warned = true;
      return null;
    }
    warned = false;
    release();
    mesh = next;
    source = nextNetwork;
    if (!group.parent) scene.add(group);
    group.add(next);
    return next;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    release();
    if (group.parent) group.parent.remove(group);
    if (typeof group.clear === 'function') group.clear();
    if (material) { material.dispose?.(); material = null; }
    source = null;
  }

  if (network) rebuild(network);

  return {
    group,
    rebuild,
    dispose,
    get mesh() { return mesh; },
    get network() { return source; }
  };
}

export { buildRoadPaint, createRoadPaint };
