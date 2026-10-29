const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

// Monumentos contract: the eight hitos of the brief are either a real municipal mesh inside its expected place or
// documented as absent from the public 3D layers; every module fits the byte budget, decodes to a sane indexed mesh
// and is streamed only while its geodata tile is resident; landmarks.js stops extruding all of them.

const root = join(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'tools/madrid/monumentos.json'), 'utf8'));
let GEO;
let sites;
let planMonuments;
let distanceToMonument;

test.before(async () => {
  ({ GEO } = await import('../js/madrid-geodata.js'));
  sites = await import('../js/monument-sites.js');
  ({ planMonuments, distanceToMonument } = await import('../js/monumentos.js'));
});

const typed = (b64, Type) => {
  const raw = Uint8Array.from(Buffer.from(b64, 'base64'));
  return new Type(raw.buffer, raw.byteOffset, raw.byteLength / Type.BYTES_PER_ELEMENT);
};
const modulePath = (m) => join(root, m.module);
const loadMonument = async (id) => {
  const meta = manifest.monuments.find((m) => m.id === id);
  const mod = await import(pathToFileURL(modulePath(meta)).href);
  return { meta, data: mod.MONUMENT };
};
const anchor = (name) => {
  const lm = GEO.landmarks[name];
  assert.ok(lm && lm.ring, `GEO.landmarks.${name} must exist`);
  return [lm.cx, lm.cz];
};
const inRect = ([x, z], [x0, z0, x1, z1], tol) =>
  x >= Math.min(x0, x1) - tol && x <= Math.max(x0, x1) + tol
  && z >= Math.min(z0, z1) - tol && z <= Math.max(z0, z1) + tol;

test('each delivered monument is a real module inside its expected place (15 m)', async () => {
  // Expected positions: real GEO.landmarks centroids, except Atocha (the historical head of the station, north-west
  // of the yard polygon in GEO.landmarks) and the palace group (midpoint of the two landmark footprints).
  const expected = {
    cibeles: { bbox: [anchor('Fuente de Cibeles')[0] - 20, anchor('Fuente de Cibeles')[1] - 20, anchor('Fuente de Cibeles')[0] + 20, anchor('Fuente de Cibeles')[1] + 20] },
    alcala: { bbox: [anchor('Puerta de Alcalá')[0] - 5, anchor('Puerta de Alcalá')[1] - 22, anchor('Puerta de Alcalá')[0] + 5, anchor('Puerta de Alcalá')[1] + 22] },
    banco: { bbox: [anchor('Banco de España')[0] - 62, anchor('Banco de España')[1] - 70, anchor('Banco de España')[0] + 62, anchor('Banco de España')[1] + 70] },
    palacio: { bbox: [-984.3, -266.9, -841.4, 163.9] } // union: Palacio Real + Almudena
  };
  assert.deepEqual(manifest.monuments.map((m) => m.id).sort(), Object.keys(expected).sort());
  for (const meta of manifest.monuments) {
    const { data } = await loadMonument(meta.id);
    assert.equal(data.id, meta.id);
    const [x0, z0, x1, z1] = data.bounds; // world metres
    const centre = [(x0 + x1) / 2, (z0 + z1) / 2];
    assert.ok(inRect(centre, expected[meta.id].bbox, 15),
      `${meta.id} centre ${centre.map((v) => v.toFixed(1))} outside ${expected[meta.id].bbox} +-15 m`);
    assert.ok(inRect([meta.bounds[0], meta.bounds[1]], expected[meta.id].bbox, 60),
      `${meta.id} mesh bounds start outside its site`);
    assert.ok(inRect([meta.bounds[2], meta.bounds[3]], expected[meta.id].bbox, 60),
      `${meta.id} mesh bounds end outside its site`);
  }
});

test('the eight sites of the brief are owned by the monument layer (strict budget, geometry sanity)', async () => {
  const wanted = ['cibeles', 'neptuno', 'alcala', 'debod', 'palacio', 'plazaespana', 'atocha', 'banco'];
  assert.deepEqual(Object.keys(sites.MONUMENT_SITES).sort(), wanted.sort());
  const delivered = new Set(manifest.monuments.map((m) => m.id));
  const missing = new Set(manifest.missing.map((m) => m.id));
  for (const id of wanted) {
    assert.ok(delivered.has(id) || missing.has(id), `${id} must be delivered or documented as missing`);
    assert.ok(!(delivered.has(id) && missing.has(id)), `${id} cannot be both delivered and missing`);
  }
  assert.deepEqual([...missing].sort(), ['atocha', 'debod', 'neptuno', 'plazaespana']);
  for (const m of manifest.missing) assert.ok(m.reason.length > 40, `${m.id} needs a documented reason`);

  let total = 0;
  for (const meta of manifest.monuments) {
    assert.ok(existsSync(modulePath(meta)), `${meta.id} module exists`);
    const bytes = statSync(modulePath(meta)).size;
    assert.ok(bytes <= 250 * 1024, `${meta.id} exceeds 250 KiB (${bytes} B)`);
    assert.equal(bytes, meta.bytes, `${meta.id} manifest bytes match the file`);
    assert.equal(createHash('md5').update(readFileSync(modulePath(meta))).digest('hex'), meta.md5);
    total += bytes;

    const { data } = await loadMonument(meta.id);
    assert.ok(data.triangles > 1000, `${meta.id} has volume (${data.triangles} tris)`);
    assert.equal(data.vertices, meta.vertices);
    assert.equal(data.triangles, meta.triangles);
    const pos = typed(data.positions, Int16Array);
    const col = typed(data.colors, Uint8Array);
    const idx = typed(data.indices, data.indexBits === 32 ? Uint32Array : Uint16Array);
    assert.equal(pos.length, data.vertices * 3);
    assert.equal(col.length, data.vertices * 3);
    assert.equal(idx.length, data.triangles * 3);
    assert.ok(pos.every((v) => v >= -32768 && v <= 32767));
    let yMin = Infinity;
    let yMax = -Infinity;
    let maxIndex = 0;
    for (let i = 0; i < pos.length; i += 3) {
      yMin = Math.min(yMin, pos[i + 1]);
      yMax = Math.max(yMax, pos[i + 1]);
    }
    for (const i of idx) maxIndex = Math.max(maxIndex, i);
    assert.ok(yMin <= 5, `${meta.id} never floats above the ground (base ${yMin / 10} m)`);
    assert.ok(yMin > -600, `${meta.id} keeps its buried part bounded (base ${yMin / 10} m)`);
    assert.ok(maxIndex < data.vertices, `${meta.id} index range`);
    assert.ok(Math.abs(yMax * data.quantum - meta.height) < 0.11, `${meta.id} height matches the manifest`);
    assert.ok(meta.height > 5, `${meta.id} height is a monument, not a slab`);
    assert.equal(meta.tile, 'fase2');
  }
  assert.ok(total <= 2 * 1024 * 1024, `total monument payload ${total} B > 2 MiB`);
  assert.equal(manifest.totals.bytes, total);
});

test('landmarks.js no longer extrudes the eight monument sites or open squares', () => {
  const extrusions = sites.landmarkExtrusions(GEO.landmarks);
  const extruded = new Set(extrusions.map((e) => e.name));
  const monumentNames = Object.values(sites.MONUMENT_SITES).flat();
  assert.ok(monumentNames.length >= 10);
  for (const name of monumentNames) {
    assert.ok(name in GEO.landmarks, `${name} is a real landmark`);
    assert.ok(!extruded.has(name), `${name} must not be extruded as a box`);
  }
  assert.ok(!extruded.has('Plaza Mayor'));
  assert.ok(!extruded.has('Puerta del Sol'));
  assert.ok(extrusions.every((e) => !/^Plaza\s/i.test(e.name)), 'open squares never become masses');
  // Control: the other emblematic buildings keep their real-height extrusion.
  const cibelesPalace = extrusions.find((e) => e.name === 'Palacio de Cibeles');
  assert.ok(cibelesPalace && Math.abs(cibelesPalace.H - 63.8) < 0.1);
  const torre = extrusions.find((e) => e.name === 'Torre de Madrid');
  assert.ok(torre && Math.abs(torre.H - 128.6) < 0.1);
});

test('monuments stream with their tile: resident + near loads, eviction drops', () => {
  const M = (id, cx, tile, bytes = 200 * 1024) => ({ id, tile, bytes, bounds: [cx - 10, -10, cx + 10, 10] });
  const monuments = [M('near', 100, 'fase2'), M('far', 1800, 'fase2'), M('other-tile', 150, 'k1'), M('big', 200, 'fase2', 3 * 1024 * 1024)];

  let plan = planMonuments({ monuments, loaded: new Set(), resident: new Set(['fase2']), x: 0, z: 0 });
  assert.deepEqual(plan.load, ['near']);
  assert.equal(distanceToMonument(monuments[0], 0, 0), 90);

  plan = planMonuments({ monuments, loaded: new Set(), resident: new Set(['fase2']), x: 0, z: 0, budget: { maxResidentBytes: 300 * 1024 } });
  assert.deepEqual(plan.load, ['near'], 'a monument over the byte budget never loads');
  assert.ok(!plan.load.includes('big'));

  plan = planMonuments({ monuments, loaded: new Set(['near', 'far', 'other-tile']), resident: new Set(['fase2']), x: 0, z: 0 });
  assert.deepEqual(plan.drop.sort(), ['far', 'other-tile'], 'distance and tile eviction');

  plan = planMonuments({ monuments, loaded: new Set(['near']), resident: new Set(), x: 0, z: 0 });
  assert.deepEqual(plan.drop, ['near'], 'losing the tile drops its monuments');
});
