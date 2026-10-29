// Resident surface topology assembled from original OSM node identities. Never
// join two roads just because their projected coordinates cross or coincide.
const SURFACE_ROADS = new Set(['primary','secondary','tertiary','residential','unclassified','living_street','service','road','primary_link','secondary_link','tertiary_link']);
const WIDTHS = { primary: 16, secondary: 14, tertiary: 11, residential: 9, unclassified: 8, living_street: 7, service: 5.5, road: 9, primary_link: 8, secondary_link: 7, tertiary_link: 6 };
const denied = value => ['no','private','agricultural','forestry'].includes(value);
const number = value => {
  const match = String(value ?? '').match(/^\s*(\d+(?:[.,]\d+)?)\s*(?:m)?\s*$/);
  return match ? Number(match[1].replace(',', '.')) : NaN;
};

export function surfaceRoadPolicy(tags) {
  if (!SURFACE_ROADS.has(tags.highway)) return null;
  // Surface driving has no surveyed bridge/tunnel profile yet. Omitting these
  // roads is safer than drawing cars at ground level beneath/above their source.
  if (tags.bridge && tags.bridge !== 'no' || tags.tunnel && tags.tunnel !== 'no' || Number(tags.layer || 0) !== 0) return null;
  const access = tags.motor_vehicle ?? tags.vehicle ?? tags.access;
  if (denied(access)) return null;
  const lanes = Number.parseInt(tags.lanes, 10) || 0;
  const width = number(tags.width);
  const dir = ['yes','true','1'].includes(tags.oneway) ? 1 : tags.oneway === '-1' ? -1
    : tags.junction === 'roundabout' && tags.oneway !== 'no' ? 1 : 0;
  return { width: width > 0 ? width : lanes > 0 ? lanes * 3.4 + 2 : WIDTHS[tags.highway], lanes, dir };
}

export function buildResidentRoadGraph(featureSets) {
  const points = new Map(), segments = new Map(), signals = new Map();
  for (const data of featureSets) {
    for (const signal of data.signals || []) signals.set(signal.id, signal);
    for (const way of data.ways || []) {
      const policy = surfaceRoadPolicy(way.tags);
      if (!policy) continue;
      for (const [id,x,z] of way.nodes) {
        const previous = points.get(id);
        if (previous && (previous.x !== x || previous.z !== z)) throw new Error(`OSM node ${id} has conflicting coordinates`);
        points.set(id, { x,z });
      }
      for (let i = 1; i < way.nodes.length; i++) {
        const a = way.nodes[i-1][0], b = way.nodes[i][0];
        if (a === b) continue;
        const key = `${way.id}:${a}:${b}`;
        segments.set(key, { a,b, wayId: way.id, name: way.tags.name || '', ...policy });
      }
    }
  }
  const incident = new Map();
  const add = (id, segment) => { if (!incident.has(id)) incident.set(id, []); incident.get(id).push(segment); };
  for (const segment of segments.values()) { add(segment.a, segment); add(segment.b, segment); }
  // Collapse only degree-two shape nodes of the same source way and policy. Keep
  // real junctions, signals, cell-edge endpoints, curves and their original path.
  const canJoin = id => {
    const at = incident.get(id);
    if (at.length !== 2 || signals.has(id)) return false;
    const [a,b] = at;
    return a.wayId === b.wayId && a.width === b.width && a.lanes === b.lanes && a.dir === b.dir && (a.b === b.a || b.b === a.a);
  };
  const visited = new Set(), chains = [];
  const follow = start => {
    if (visited.has(start)) return;
    const ids = [start.a, start.b];
    visited.add(start);
    let current = start;
    while (canJoin(current.b)) {
      const next = incident.get(current.b).find(s => s !== current);
      if (visited.has(next) || next.a !== current.b) break;
      visited.add(next); ids.push(next.b); current = next;
    }
    if (ids[0] === ids.at(-1) && ids.length > 3) {
      // A closed way needs two real source anchors: a self-link would be
      // discarded by the lane builder, erasing an isolated roundabout/loop.
      const middle = Math.floor((ids.length - 1) / 2);
      chains.push({ ...start, ids: ids.slice(0, middle + 1) }, { ...start, ids: ids.slice(middle) });
    } else chains.push({ ...start, ids });
  };
  for (const segment of segments.values()) if (!canJoin(segment.a)) follow(segment);
  for (const segment of segments.values()) follow(segment); // isolated closed ways
  const nodes = [], links = [], names = [], osmNodeIds = [];
  const nodeIds = new Map(), nameIds = new Map();
  const nodeIndex = id => {
    if (!nodeIds.has(id)) { nodeIds.set(id, nodes.length/2); osmNodeIds.push(id); const p = points.get(id); nodes.push(p.x,p.z); }
    return nodeIds.get(id);
  };
  for (const chain of chains) {
    const a = chain.ids[0], b = chain.ids.at(-1);
    if (!nameIds.has(chain.name)) { nameIds.set(chain.name,names.length); names.push(chain.name); }
    links.push([nodeIndex(a),nodeIndex(b),nameIds.get(chain.name),chain.width,chain.lanes,chain.dir,
      chain.ids.slice(1,-1).flatMap(id => { const p = points.get(id); return [p.x,p.z]; })]);
  }
  return { nodes,links,names,osmNodeIds, signals: [...signals.values()].filter(s => nodeIds.has(s.id)) };
}
