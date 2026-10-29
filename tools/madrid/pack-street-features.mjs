// Enrich the existing ready tiles from extract-osm-features.py, retaining original
// OSM node IDs, access/grade tags, exact tree points, and content-addressed modules.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { toWorld } from './projection.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const input = process.argv[2];
if (!input) throw new Error('usage: node tools/madrid/pack-street-features.mjs /tmp/features.json');
const data = JSON.parse(fs.readFileSync(input, 'utf8'));
const manifestFile = path.join(root, 'tools/madrid/tiles.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const tiles = manifest.tiles.filter(t => t.status === 'ready');
const batches = new Map(tiles.map(t => [t.id, { source: data.source, trees: [], signals: [], ways: [] }]));
const keepTags = (tags, keys) => Object.fromEntries(keys.filter(k => tags[k] !== undefined).map(k => [k, tags[k]]));
const roadKeys = ['highway','name','width','lanes','oneway','junction','layer','bridge','tunnel','access','motor_vehicle','vehicle','service','foot','bicycle','sidewalk','maxspeed'];
const pointKeys = ['height','diameter_crown','genus','species','leaf_type','leaf_cycle','highway','traffic_signals:direction','direction'];
const world = (lon, lat) => toWorld(lon, lat).map(v => Math.round(v * 100) / 100);
const owner = (x, z) => tiles.find(t => t.core.some(([x0,z0,x1,z1]) => x >= x0 && x < x1 && z >= z0 && z < z1));
for (const type of ['trees', 'signals']) for (const point of data[type]) {
  const [x,z] = world(point.lon, point.lat), tile = owner(x,z);
  if (tile) batches.get(tile.id)[type].push({ id: point.id, x, z, tags: keepTags(point.tags, pointKeys) });
}
for (const way of data.roads) {
  const nodes = way.nodes.map(([id,lon,lat]) => [id,...world(lon,lat)]);
  // Assign each original segment once. Endpoints retain OSM identity across cell seams.
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i-1], b = nodes[i], tile = owner((a[1]+b[1])/2,(a[2]+b[2])/2);
    if (!tile) continue;
    const ways = batches.get(tile.id).ways;
    const previous = ways.at(-1);
    if (previous?.id === way.id && previous.nodes.at(-1)[0] === a[0]) previous.nodes.push(b);
    else ways.push({ id: way.id, tags: keepTags(way.tags, roadKeys), nodes: [a,b] });
  }
}
const planned = [];
for (const tile of tiles) {
  const file = path.join(root, tile.module);
  const marker = '// BEGIN sourced street features';
  const original = fs.readFileSync(file, 'utf8').split(marker)[0].trimEnd();
  const symbol = tile.id === 'fase2' ? 'GEO' : 'TILE';
  let content;
  if (symbol === 'TILE') {
    const match = /export const TILE = (.*);\s*$/s.exec(original);
    if (!match) throw new Error(`Invalid TILE module: ${file}`);
    const payload = JSON.parse(match[1]);
    payload.streetFeatures = batches.get(tile.id);
    content = original.slice(0, match.index) + `export const TILE = ${JSON.stringify(payload)};\n`;
  } else {
    content = `${original}\n${marker}\n${symbol}.streetFeatures=${JSON.stringify(batches.get(tile.id))};\n`;
  }
  planned.push({ file, content });
  tile.bytes = Buffer.byteLength(content);
  tile.md5 = createHash('md5').update(content).digest('hex');
  console.log(JSON.stringify({ id: tile.id, bytes: tile.bytes, trees: batches.get(tile.id).trees.length, ways: batches.get(tile.id).ways.length }));
}
const totalBytes = tiles.reduce((n,t) => n + t.bytes + (t.blocksBytes || 0), 0);
if (totalBytes > manifest.budget.maxResidentBytes) {
  throw new Error(`Street enrichment exceeds existing ready-data gate: ${totalBytes} B; no files written`);
}
for (const { file, content } of planned) fs.writeFileSync(file, content);
manifest.streetFeaturesSource = data.source;
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1)+'\n');
