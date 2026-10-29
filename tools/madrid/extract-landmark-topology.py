#!/usr/bin/env python3
"""Recover original OSM topology around Banco de España / Palacio de Cibeles.

Requires pyosmium. No geometry, holes, heights or roof semantics are inferred.
First read identifies the two source outer outlines and Banco multipolygon;
second read preserves every member plus tagged building/roof features whose
vertices lie in either outer bbox. Output is original WGS84 node coordinates;
project with tools/madrid/projection.mjs:toWorld when needed.
"""
import argparse
import hashlib
import json
from pathlib import Path
import osmium

TARGETS = {
    'Banco de España': {'relation': 2614014, 'outer': 4487661},
    'Palacio de Cibeles': {'outer': 16322055},
}


def record_way(way):
    if any(not n.location.valid() for n in way.nodes):
        raise ValueError(f'Way {way.id} has unresolved nodes; refusing partial geometry')
    return {'id': way.id, 'version': way.version, 'timestamp': str(way.timestamp),
            'tags': dict(way.tags),
            'nodes': [[n.ref, n.lon, n.lat] for n in way.nodes]}


def stitched_rings(members, ways, role):
    """Join only matching OSM endpoint IDs, preserving member provenance."""
    pending = [(m['ref'], [n[0] for n in ways[m['ref']]['nodes']])
               for m in members if m['type'] == 'w' and m['role'] == role]
    rings = []
    while pending:
        wid, chain = pending.pop(0)
        ids = [wid]
        while chain[0] != chain[-1]:
            for i, (next_id, nodes) in enumerate(pending):
                if nodes[0] == chain[-1]:
                    chain.extend(nodes[1:])
                elif nodes[-1] == chain[-1]:
                    chain.extend(reversed(nodes[:-1]))
                else:
                    continue
                ids.append(next_id)
                pending.pop(i)
                break
            else:
                raise ValueError(f'Unclosed {role} ring from members {ids}')
        rings.append({'role': role, 'ways': ids, 'nodeIds': chain})
    return rings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pbf', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    outer_ids = {t['outer'] for t in TARGETS.values()}
    relation_ids = {t['relation'] for t in TARGETS.values() if 'relation' in t}

    class Find(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.outers, self.relations = {}, {}

        def way(self, way):
            if way.id in outer_ids:
                self.outers[way.id] = record_way(way)

        def relation(self, relation):
            if relation.id in relation_ids:
                self.relations[relation.id] = {
                    'id': relation.id, 'version': relation.version, 'timestamp': str(relation.timestamp),
                    'tags': dict(relation.tags),
                    'members': [{'type': m.type, 'ref': m.ref, 'role': m.role} for m in relation.members]}

    found = Find()
    found.apply_file(str(args.pbf), locations=True, idx='flex_mem')
    if set(found.outers) != outer_ids or set(found.relations) != relation_ids:
        raise ValueError('Input PBF does not contain the expected source buildings')
    member_ids = {m['ref'] for r in found.relations.values() for m in r['members'] if m['type'] == 'w'}
    bounds = {}
    for name, target in TARGETS.items():
        coords = found.outers[target['outer']]['nodes']
        bounds[name] = [min(n[1] for n in coords), min(n[2] for n in coords),
                        max(n[1] for n in coords), max(n[2] for n in coords)]

    class Context(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.ways = dict(found.outers)
            self.relations = dict(found.relations)

        def way(self, way):
            tags = dict(way.tags)
            member = way.id in member_ids
            relevant = any(k == 'building' or k == 'covered' or k.startswith('building:') or
                           k.startswith('roof:') for k in tags)
            if not member and not relevant:
                return
            if any(not n.location.valid() for n in way.nodes):
                if member:
                    raise ValueError(f'Unresolved relation member {way.id}')
                return
            owners = [name for name, (w, s, e, n) in bounds.items()
                      if any(w <= node.lon <= e and s <= node.lat <= n for node in way.nodes)]
            if member or owners:
                record = record_way(way)
                record['bboxCandidates'] = owners  # candidates only; bbox overlap is NOT containment
                self.ways[way.id] = record

        def relation(self, relation):
            # Retain related building multipolygons without calling their missing members holes.
            tags = dict(relation.tags)
            if relation.id not in self.relations and tags.get('type') in ('building', 'multipolygon'):
                if any(m.type == 'w' and m.ref in self.ways for m in relation.members):
                    self.relations[relation.id] = {
                        'id': relation.id, 'version': relation.version, 'timestamp': str(relation.timestamp),
                        'tags': tags,
                        'members': [{'type': m.type, 'ref': m.ref, 'role': m.role} for m in relation.members]}

    context = Context()
    context.apply_file(str(args.pbf), locations=True, idx='flex_mem')
    missing = member_ids - context.ways.keys()
    if missing:
        raise ValueError(f'Missing original members: {missing}')
    buildings = {}
    for name, target in TARGETS.items():
        relation = context.relations.get(target.get('relation'))
        rings = stitched_rings(relation['members'], context.ways, 'outer') + stitched_rings(
            relation['members'], context.ways, 'inner') if relation else [
                {'role': 'outer', 'ways': [target['outer']],
                 'nodeIds': [n[0] for n in context.ways[target['outer']]['nodes']]}]
        if any(r['nodeIds'][0] != r['nodeIds'][-1] for r in rings):
            raise ValueError('Unclosed building outer')
        buildings[name] = {**target, 'bbox': bounds[name], 'rings': rings}
    with args.pbf.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    result = {
        'source': {'provider': 'OpenStreetMap / Geofabrik Madrid', 'license': 'ODbL-1.0',
                   'url': 'https://download.geofabrik.de/europe/spain/madrid.html', 'sha256': digest},
        'coordinates': {'crs': 'EPSG:4326', 'nodeLayout': ['osmNodeId', 'longitude', 'latitude'],
                        'worldProjection': 'tools/madrid/projection.mjs:toWorld',
                        'worldOrigin': [-3.7037900, 40.4167750], 'worldAxes': ['east', 'south'],
                        'worldUnits': 'metres'},
        'buildings': buildings,
        'relations': sorted(context.relations.values(), key=lambda r: r['id']),
        'ways': sorted(context.ways.values(), key=lambda w: w['id'])}
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps({'ways': len(result['ways']), 'relations': len(result['relations']),
                      'rings': {name: [r['role'] for r in b['rings']] for name, b in buildings.items()}}))


if __name__ == '__main__':
    main()
