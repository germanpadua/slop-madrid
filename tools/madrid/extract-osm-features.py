#!/usr/bin/env python3
"""Extract sourced road topology, tree points and signals from a local regional OSM PBF.

Requires pyosmium. Cache the input/output in /tmp; no Overpass or paid services.
Example: python extract-osm-features.py /tmp/madrid.osm.pbf /tmp/features.json \
  --bbox=-3.75,40.39,-3.65,40.46
Roads retain OSM node identities and access/grade tags; crossings are never inferred
from geometric intersections. Complete ways are retained if any vertex enters bbox.
"""
import argparse
import hashlib
import json
from pathlib import Path
import osmium


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pbf', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--bbox', required=True, help='west,south,east,north in WGS84')
    args = parser.parse_args()
    west, south, east, north = map(float, args.bbox.split(','))
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        parser.error('invalid WGS84 bbox')

    def inside(lon, lat):
        return west <= lon <= east and south <= lat <= north

    class Features(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.trees, self.signals, self.roads = [], [], []

        def node(self, node):
            if not node.location.valid() or not inside(node.location.lon, node.location.lat):
                return
            tags = dict(node.tags)
            record = {'id': node.id, 'lon': node.location.lon, 'lat': node.location.lat, 'tags': tags}
            if tags.get('natural') == 'tree':
                self.trees.append(record)
            if tags.get('highway') == 'traffic_signals':
                self.signals.append(record)

        def way(self, way):
            tags = dict(way.tags)
            if 'highway' not in tags:
                return
            if any(not node.location.valid() for node in way.nodes):
                return  # Never bridge an unknown/missing node.
            nodes = [[node.ref, node.lon, node.lat] for node in way.nodes]
            if len(nodes) < 2 or not any(inside(lon, lat) for _, lon, lat in nodes):
                return
            self.roads.append({'id': way.id, 'tags': tags, 'nodes': nodes})

    handler = Features()
    handler.apply_file(str(args.pbf), locations=True, idx='flex_mem')
    with args.pbf.open('rb') as source_file:
        digest = hashlib.file_digest(source_file, 'sha256').hexdigest()
    result = {'source': {'provider': 'OpenStreetMap / Geofabrik Madrid', 'license': 'ODbL-1.0',
                         'url': 'https://download.geofabrik.de/europe/spain/madrid.html',
                         'sha256': digest, 'bbox': [west, south, east, north]},
              'trees': handler.trees, 'signals': handler.signals, 'roads': handler.roads}
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps({key: len(result[key]) for key in ('trees', 'signals', 'roads')}))


if __name__ == '__main__':
    main()
