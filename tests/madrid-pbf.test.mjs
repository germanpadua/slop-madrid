import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'tools/madrid/tiles.json')));
const readyTiles = () => manifest.tiles.filter((t) => t.status === 'ready');
const insideRect = ([x, z], [x0, z0, x1, z1], tol = 0) => x >= x0 - tol && x <= x1 + tol && z >= z0 - tol && z <= z1 + tol;

test('PBF adapter preserves shared node IDs and inner roles, and rejects ways with missing nodes', () => {
  const xml = '<osm><node id="1" lon="-3.7" lat="40.4"/><node id="2" lon="-3.6" lat="40.5"/>' +
    '<way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>' +
    '<way id="11"><nd ref="2"/><nd ref="1"/></way><way id="12"><nd ref="1"/><nd ref="999"/></way>' +
    '<relation id="20"><member type="way" ref="10" role="outer"/><member type="way" ref="11" role="inner"/></relation></osm>';
  const result = spawnSync('python3', ['-c', `
import importlib.util,json,sys,tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('pbf',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 p=Path(d)/'cell.osm';p.write_text(sys.stdin.read());print(json.dumps(m.overpass_shape(p)))
`, join(root, 'tools/madrid/pbf.py')], { encoding: 'utf8', input: xml, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.status, 0, result.stderr);
  const { elements } = JSON.parse(result.stdout);
  const a = elements.find((e) => e.id === 10), b = elements.find((e) => e.id === 11);
  assert.equal(a.geometry[1].id, b.geometry[0].id);
  assert.ok(!elements.some((e) => e.id === 12));
  const relation = elements.find((e) => e.id === 20);
  assert.equal(relation.members[1].role, 'inner');
  assert.deepEqual(relation.members[0].geometry, a.geometry);
});

test('expansion never repeats an existing seed parcel (including legacy owners)', async () => {
  const { GEO } = await import('../js/madrid-geodata.js');
  const seen = new Set(GEO.parcels.flat().map((p) => p.ring.join(',')));
  for (const t of readyTiles().filter((t) => t.id !== 'fase2')) {
    const TILE = JSON.parse(/export const TILE = (.*);\s*$/s.exec(readFileSync(join(root, t.module), 'utf8'))[1]);
    for (const p of TILE.parcels) {
      const key = p.ring.join(',');
      assert.ok(!seen.has(key), `duplicate seed/legacy/new parcel in ${t.id}`);
      seen.add(key);
    }
  }
});
test('PBF cells carry source provenance, connected graph indices and sourced street nodes inside their core', () => {
  const expanded = readyTiles().filter((t) => t.sourceSnapshot);
  assert.ok(expanded.length >= 10, 'contiguous phase4 sample is delivered');
  for (const t of expanded) {
    assert.match(t.sourceSnapshot.osmUrl, /^https:\/\/download.geofabrik.de\//);
    assert.match(t.sourceSnapshot.osmMd5, /^[0-9a-f]{32}$/);
    const TILE = JSON.parse(/export const TILE = (.*);\s*$/s.exec(readFileSync(join(root, t.module), 'utf8'))[1]);
    const g = TILE.roadGraph;
    assert.ok(g.nodes.length > 0 && g.links.length > 0);
    for (const [a, b, name, width, lanes, dir, inner] of g.links) {
      assert.ok(a >= 0 && b >= 0 && a * 2 < g.nodes.length && b * 2 < g.nodes.length);
      assert.ok(name >= 0 && name < g.names.length && width > 0 && lanes >= 0 && Math.abs(dir) <= 1);
      assert.ok(Array.isArray(inner) && inner.length % 2 === 0);
    }
    for (const p of TILE.streetPoints) {
      assert.match(p.id, /^n\d+$/);
      assert.ok(['tree', 'street_lamp', 'traffic_signals'].includes(p.kind));
      assert.ok(t.core.some((r) => insideRect([p.x, p.z], r, 0.11)));
      assert.ok(p.h === null || p.h > 0);
    }
  }
});

test('IDEAM interior rings remain courtyards instead of being silently filled by the building roof', () => {
  let holes = 0;
  for (const t of readyTiles().filter((t) => t.sourceSnapshot)) {
    const TILE = JSON.parse(/export const TILE = (.*);\s*$/s.exec(readFileSync(join(root, t.module), 'utf8'))[1]);
    for (const p of TILE.parcels) for (const h of p.holes || []) {
      holes++;
      assert.ok(h.length >= 6 && h.length % 2 === 0 && h.every(Number.isFinite));
      const outer = new Set(Array.from({ length: p.ring.length / 2 }, (_, i) => `${p.ring[i * 2]},${p.ring[i * 2 + 1]}`));
      assert.ok(!Array.from({ length: h.length / 2 }, (_, i) => `${h[i * 2]},${h[i * 2 + 1]}`).every((k) => outer.has(k)), 'exterior must never become its own hole');
    }
  }
  assert.ok(holes > 100, `${holes} sourced courtyards preserved`);
});
