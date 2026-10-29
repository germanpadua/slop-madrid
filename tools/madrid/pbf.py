#!/usr/bin/env python3
"""Cell-at-a-time OSM PBF + IDEAM pipeline. Requires osmium-tool; no Overpass/personal credentials.

python3 tools/madrid/pbf.py --pbf /tmp/slop-paridad-cache/madrid-261028.osm.pbf k1j3 k2j3
Cache defaults to /tmp/slop-paridad-cache; --clean-tile-cache releases intermediate extracts after each build.
Existing ready modules are never replaced unless --rebuild is explicit. Run tiles.mjs manifest/verify afterwards.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
HEIGHT_URL = 'https://sigma.madrid.es/hosted/rest/services/CARTOGRAFIA/EDIFICIOS_ALTURAS/MapServer/0/query'


def write_json(path, data):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n' if path.name == 'tiles.json'
                    else json.dumps(data, separators=(',', ':')))
    temp.replace(path)


def overpass_shape(xml_path):
    """Reconstruct out-geom shape while retaining OSM node identity and relation roles, including inner rings."""
    tree = ET.parse(xml_path).getroot()
    nodes = {int(n.attrib['id']): {k: float(n.attrib[k]) for k in ('lon', 'lat')} for n in tree.findall('node')}
    ways = {}
    elements = []
    for element in tree:
        kind = element.tag
        if kind not in ('node', 'way', 'relation'):
            continue
        ident = int(element.attrib['id'])
        tags = {tag.attrib['k']: tag.attrib['v'] for tag in element.findall('tag')}
        item = {'type': kind, 'id': ident, 'tags': tags}
        if kind == 'node':
            item.update(nodes[ident])
            if tags:
                elements.append(item)
        elif kind == 'way':
            refs = [int(nd.attrib['ref']) for nd in element.findall('nd')]
            # Missing a node means incomplete source geometry. Never join the surviving ends across the gap.
            if not all(ref in nodes for ref in refs):
                continue
            item['geometry'] = [{**nodes[ref], 'id': ref} for ref in refs]
            ways[ident] = item['geometry']
            elements.append(item)
        else:
            item['members'] = []
            for member in element.findall('member'):
                m = {**member.attrib, 'ref': int(member.attrib['ref'])}
                if m['type'] == 'way' and m['ref'] in ways:
                    m['geometry'] = ways[m['ref']]
                item['members'].append(m)
            elements.append(item)
    return {'version': 0.6, 'generator': 'slop-madrid osmium PBF adapter', 'elements': elements}


def heights(bbox, cache):
    key = hashlib.md5(','.join(map(str, bbox)).encode()).hexdigest()
    dest = cache / f'ideam-{key}.json'
    if dest.exists():
        return dest
    features = []
    offset = 0
    while True:
        params = dict(where='1=1', geometry=','.join(map(str, bbox)), geometryType='esriGeometryEnvelope',
                      inSR=25830, outSR=25830, outFields='OBJECTID,ALTURA,Z_EDIFICIO_HUELLA,ORIGEN,ID_3D',
                      returnGeometry='true', orderByFields='OBJECTID', resultOffset=offset, resultRecordCount=2000, f='json')
        req = urllib.request.Request(HEIGHT_URL + '?' + urllib.parse.urlencode(params), headers={'User-Agent': 'slop-madrid/1.0'})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=120) as res:
                    data = json.load(res)
                if data.get('error'):
                    raise RuntimeError(data['error'])
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)
        page = data.get('features', [])
        features.extend(page)
        print(f'IDEAM offset={offset} +{len(page)}', flush=True)
        if not data.get('exceededTransferLimit'):
            break
        if not page:
            raise RuntimeError('IDEAM exceededTransferLimit with an empty page')
        offset += len(page)
    ids = [f['attributes']['OBJECTID'] for f in features]
    if len(set(ids)) != len(ids):
        raise RuntimeError('IDEAM pagination returned duplicate OBJECTID')
    write_json(dest, {'count': len(features), 'crs': 'EPSG:25830', 'bbox': bbox, 'features': features,
                      'source': HEIGHT_URL, 'downloaded': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
    return dest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pbf', type=Path, required=True)
    parser.add_argument('--source-url', default='https://download.geofabrik.de/europe/spain/madrid-261028.osm.pbf')
    parser.add_argument('--cache', type=Path, default=Path('/tmp/slop-paridad-cache'))
    parser.add_argument('--clean-tile-cache', action='store_true')
    parser.add_argument('--rebuild', action='store_true')
    parser.add_argument('tiles', nargs='+')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    digest = hashlib.md5(args.pbf.read_bytes()).hexdigest()
    checksum_file = Path(str(args.pbf) + '.md5')
    if checksum_file.exists() and checksum_file.read_text().split()[0] != digest:
        raise RuntimeError('PBF does not match provider MD5')
    manifest_path = ROOT / 'tools/madrid/tiles.json'
    for ident in args.tiles:
        manifest = json.loads(manifest_path.read_text())
        tile = next(t for t in manifest['tiles'] if t['id'] == ident)
        if ident == 'fase2':
            raise RuntimeError('Seed rebuild is deliberately separate; use tiles.mjs build-seed')
        if tile['status'] == 'ready' and not args.rebuild:
            print(f'{ident}: ready, preserved', flush=True)
            continue
        started = time.monotonic()
        cell_dir = args.cache / ident
        cell_dir.mkdir(exist_ok=True)
        pbf = cell_dir / 'cell.osm.pbf'
        xml = cell_dir / 'cell.osm'
        bbox = ','.join(map(str, tile['bboxWgs84']))
        subprocess.run(['osmium', 'extract', '-b', bbox, '-s', 'smart', '-S', 'types=multipolygon,boundary',
                        str(args.pbf), '-o', str(pbf), '--overwrite'], check=True)
        subprocess.run(['osmium', 'cat', str(pbf), '-o', str(xml), '--overwrite'], check=True)
        write_json(cell_dir / 'osm_madrid.json', overpass_shape(xml))
        shutil.copyfile(heights(tile['fetch'], args.cache), cell_dir / 'alturas.json')
        subprocess.run(['node', 'tools/madrid/build.mjs', tile['module']], cwd=ROOT,
                       env={**os.environ, 'MADRID_TILE': ident, 'MADRID_DATA': str(cell_dir)}, check=True)
        subprocess.run(['node', 'tools/madrid/tiles.mjs', 'manifest'], cwd=ROOT, check=True)
        # Persist provenance per tile, not an unversioned global note. The file's own md5 is reconciled above.
        manifest = json.loads(manifest_path.read_text())
        updated = next(t for t in manifest['tiles'] if t['id'] == ident)
        updated['sources'] = ['OpenStreetMap / Geofabrik PBF (© OpenStreetMap contributors, ODbL)',
                              'IDEAM EDIFICIOS_ALTURAS (© Ayuntamiento de Madrid)']
        updated['sourceSnapshot'] = {'osmUrl': args.source_url, 'osmMd5': digest,
                                     'ideamUrl': HEIGHT_URL, 'date': time.strftime('%Y-%m-%d', time.gmtime())}
        write_json(manifest_path, manifest)
        print(f'{ident}: {updated["bytes"]} bytes in {time.monotonic() - started:.1f}s', flush=True)
        if args.clean_tile_cache:
            shutil.rmtree(cell_dir)


if __name__ == '__main__':
    main()
