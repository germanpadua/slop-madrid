// Resident data only. Geometry enters/leaves with the owning tile; no implicit roads through unloaded cores.
const toPts = (flat) => Array.from({ length: flat.length / 2 }, (_, i) => ({ x: flat[i * 2], z: flat[i * 2 + 1] }));
const pointKey = (x, z) => `${Math.round(x * 10)},${Math.round(z * 10)}`;
const roadObject = ([name, w, dir, lanes, hw, flat]) => ({ name, raw: name, w, dir, lanes, highway: !!hw, pts: toPts(flat) });

export function createActiveMadridData(seed) {
  const tiles = new Map([['fase2', { ...seed, id: 'fase2', core: seed.core || [seed.frame.bbox] }]]);
  let version = 0;
  let cached = null;
  function snapshot() {
    if (cached) return cached;
    const roads = [], segments = new Set();
    const nodes = [], links = [], names = [], ids = new Map(), nameIds = new Map();
    const node = (x, z) => {
      const k = pointKey(x, z);
      if (!ids.has(k)) { ids.set(k, nodes.length / 2); nodes.push(x, z); }
      return ids.get(k);
    };
    const add = (name, w, dir, lanes, pts) => {
      if (!nameIds.has(name)) { nameIds.set(name, names.length); names.push(name); }
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const ka = pointKey(a.x, a.z), kb = pointKey(b.x, b.z);
        if (ka === kb) continue;
        const forward = ka < kb;
        const k = `${forward ? ka : kb}|${forward ? kb : ka}|${forward ? dir : -dir}`;
        if (segments.has(k)) continue;
        segments.add(k);
        links.push([node(a.x, a.z), node(b.x, b.z), nameIds.get(name), w, lanes, dir, []]);
      }
    };
    const roadKeys = new Set();
    for (const tile of tiles.values()) {
      for (const raw of tile.roads || []) {
        const road = roadObject(raw);
        const key = JSON.stringify(raw);
        if (!roadKeys.has(key)) { roadKeys.add(key); roads.push(road); }
      }
      const graph = tile.roadGraph;
      if (graph) {
        for (const [a, b, ni, w, lanes, dir, inner] of graph.links) {
          const pts = [{ x: graph.nodes[a * 2], z: graph.nodes[a * 2 + 1] },
            ...toPts(inner), { x: graph.nodes[b * 2], z: graph.nodes[b * 2 + 1] }];
          add(graph.names[ni], w, dir, lanes, pts);
        }
      } else {
        // Legacy phase3: join only stored vertices, never intersections inferred from 2D line crossings.
        for (const raw of tile.roads || []) { const r = roadObject(raw); add(r.name, r.w, r.dir, r.lanes, r.pts); }
      }
    }
    const cores = [...tiles.values()].flatMap((t) => t.core || []);
    const bounds = {
      minX: Math.min(...cores.map((r) => r[0])), maxX: Math.max(...cores.map((r) => r[2])),
      minZ: Math.min(...cores.map((r) => r[1])), maxZ: Math.max(...cores.map((r) => r[3]))
    };
    cached = { version, tiles: [...tiles.values()], roads, cores, bounds, roadGraph: { nodes, links, names } };
    return cached;
  }
  function set(tile) {
    if (tile.id === 'fase2' || tiles.get(tile.id) === tile) return false;
    tiles.set(tile.id, tile); version++; cached = null; return true;
  }
  function remove(id) {
    if (id === 'fase2' || !tiles.delete(id)) return false;
    version++; cached = null; return true;
  }
  function clamp(x, z, margin = 0) {
    let best = null, distance = Infinity;
    for (const [x0, z0, x1, z1] of snapshot().cores) {
      if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return { x, z };
      const px = Math.max(x0 + margin, Math.min(x1 - margin, x));
      const pz = Math.max(z0 + margin, Math.min(z1 - margin, z));
      const d = Math.hypot(px - x, pz - z);
      if (d < distance) { distance = d; best = { x: px, z: pz }; }
    }
    return best || { x, z };
  }
  // Dijkstra with a binary min heap. Failure returns no route, never a line through an unloaded neighbourhood.
  function route(from, to) {
    const { nodes, links } = snapshot().roadGraph;
    const nearest = (p) => {
      let id = -1, best = 120;
      for (let i = 0; i < nodes.length; i += 2) {
        const d = Math.hypot(p.x - nodes[i], p.z - nodes[i + 1]);
        if (d < best) { best = d; id = i / 2; }
      }
      return id;
    };
    const start = nearest(from), goal = nearest(to);
    if (start < 0 || goal < 0) return [];
    const adjacency = Array.from({ length: nodes.length / 2 }, () => []);
    for (const [a, b, , , , dir] of links) {
      const length = Math.hypot(nodes[a * 2] - nodes[b * 2], nodes[a * 2 + 1] - nodes[b * 2 + 1]);
      if (dir >= 0) adjacency[a].push([b, length]);
      if (dir <= 0) adjacency[b].push([a, length]);
    }
    const heap = [], dist = new Float64Array(adjacency.length).fill(Infinity), prev = new Int32Array(adjacency.length).fill(-1);
    const push = (item) => {
      let i = heap.length; heap.push(item);
      while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= item[0]) break; heap[i] = heap[p]; i = p; }
      heap[i] = item;
    };
    const pop = () => {
      const first = heap[0], last = heap.pop();
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let c = i * 2 + 1;
          if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++;
          if (heap[c][0] >= last[0]) break;
          heap[i] = heap[c]; i = c;
        }
        heap[i] = last;
      }
      return first;
    };
    dist[start] = 0; push([0, start]);
    while (heap.length) {
      const [d, a] = pop();
      if (d > dist[a]) continue;
      if (a === goal) break;
      for (const [b, cost] of adjacency[a]) {
        const next = d + cost;
        if (next < dist[b]) { dist[b] = next; prev[b] = a; push([next, b]); }
      }
    }
    if (!Number.isFinite(dist[goal])) return [];
    const path = [];
    for (let a = goal; a >= 0; a = prev[a]) path.push({ x: nodes[a * 2], z: nodes[a * 2 + 1] });
    return path.reverse();
  }
  return { tiles, set, remove, snapshot, clamp, route, get version() { return version; } };
}
