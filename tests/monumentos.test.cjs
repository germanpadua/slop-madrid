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

test('each delivered monument is a real module inside its expected place', async () => {
  // Expected positions: real GEO.landmarks centroids where they exist; fixed world coordinates (the Sol frame of
  // js/landmarks) where the landmark has no GEO entry (Neptuno, Metrópolis) or the mesh covers the whole parcel
  // (Atocha yard, Palacio Real).
  const at = (name, dx, dz) => {
    const [x, z] = anchor(name);
    return { bbox: [x - dx, z - dz, x + dx, z + dz] };
  };
  const expected = {
    cibeles: at('Fuente de Cibeles', 20, 20),
    alcala: at('Puerta de Alcalá', 5, 22),
    banco: at('Banco de España', 62, 70),
    palacio: { bbox: [-990, -270, -805, 20] },     // Palacio Real (Almudena is its own module now)
    almudena: at('Catedral de la Almudena', 70, 70),
    debod: at('Templo de Debod', 45, 45),
    plazaespana: at('Plaza de España', 170, 170),  // monumento a Cervantes, inside the plaza ring
    neptuno: { bbox: [875, 148, 925, 198] },       // Plaza de Cánovas del Castillo (no GEO entry)
    metropolis: { bbox: [640, -215, 726, -100] },  // Calle de Alcalá 42 (no GEO entry)
    atocha: { bbox: [980, 1040, 1460, 1625] }      // yard roof; the historic facade is not in the LOD2
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
  assert.deepEqual([...missing].sort(), []);
  for (const m of manifest.missing) assert.ok(m.reason.length > 40, `${m.id} needs a documented reason`);

  // Low-poly hand-modelled pieces (no municipal mesh exists) may be leaner; real municipal meshes stay detailed.
  const minTris = { neptuno: 4500, debod: 3500, plazaespana: 12000, metropolis: 150 };
  let total = 0;
  for (const meta of manifest.monuments) {
    assert.ok(existsSync(modulePath(meta)), `${meta.id} module exists`);
    const bytes = statSync(modulePath(meta)).size;
    assert.ok(bytes <= 250 * 1024, `${meta.id} exceeds 250 KiB (${bytes} B)`);
    assert.equal(bytes, meta.bytes, `${meta.id} manifest bytes match the file`);
    assert.equal(createHash('md5').update(readFileSync(modulePath(meta))).digest('hex'), meta.md5);
    total += bytes;

    const { data } = await loadMonument(meta.id);
    assert.ok(data.triangles > (minTris[meta.id] ?? 1000), `${meta.id} has volume (${data.triangles} tris)`);
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
    assert.ok(yMax * data.quantum <= 120, `${meta.id} stays below +120 m`);
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

test('municipal modules and the Cibeles basin retain their original geometry', async () => {
  const protectedHashes = {
    alcala: '8031c6f96dd21e65ad86b480ec17c5d6', banco: 'bf8e29064f7cdc525059f2805b759511',
    palacio: '5a5b1fd1f153fe63c5e613e8f397dc89', almudena: 'c064cff098e289b960e11ecee6c426f7',
    metropolis: '750c7ff24f049679ee07a3a1a23d0d8f', atocha: 'fcbe5a96768f3502566c86b07aaf3b7c'
  };
  for (const [id, hash] of Object.entries(protectedHashes)) {
    const meta = manifest.monuments.find((m) => m.id === id);
    assert.equal(createHash('md5').update(readFileSync(modulePath(meta))).digest('hex'), hash, id);
  }
  const { data } = await loadMonument('cibeles');
  assert.deepEqual(data.proceduralStart, { vertices: 3371, triangles: 7791 });
  assert.deepEqual(data.origin, [895.2, 0, -291.6]);
  const basin = {
    positions: [3371 * 6, 'c4687a0193896c2cda1df4f808f8febe16d5630286b4e93b604b40f4c6b5c02e'],
    colors: [3371 * 3, 'ea35e53a31e9b50c7143dda66612f4c36412d42e7862602a4672838f9e105b8d'],
    indices: [7791 * 6, 'efe956a421d60e7851c2b79e0d04022ecadb720fb678eaae4465f2f1ea47fcbe']
  };
  for (const [field, [size, hash]] of Object.entries(basin)) {
    assert.equal(createHash('sha256').update(Buffer.from(data[field], 'base64').subarray(0, size)).digest('hex'), hash, field);
  }
  const indices = typed(data.indices, Uint16Array);
  assert.ok(indices.slice(0, 7791 * 3).every((i) => i < 3371));
  assert.ok(indices.slice(7791 * 3).every((i) => i >= 3371));
  assert.ok(data.triangles - 7791 > 6500, 'Cibeles sculpture has its own substantial detail');
});

test('procedural modules use ground-level bases and declare their manual provenance', async () => {
  for (const id of ['neptuno', 'debod', 'plazaespana']) {
    const { data } = await loadMonument(id);
    assert.equal(data.quantum, 0.1);
    assert.equal(data.service, 'modelado manual');
    const pos = typed(data.positions, Int16Array);
    let minY = Infinity;
    for (let i = 1; i < pos.length; i += 3) minY = Math.min(minY, pos[i]);
    assert.equal(minY, 0, `${id} rests exactly on y=0`);
  }
});

test('procedural detail survives decimetre quantization without collapsed triangles', async () => {
  for (const id of ['cibeles', 'neptuno', 'debod', 'plazaespana']) {
    const { data } = await loadMonument(id);
    const pos = typed(data.positions, Int16Array);
    const idx = typed(data.indices, data.indexBits === 32 ? Uint32Array : Uint16Array);
    const start = (data.proceduralStart?.triangles ?? 0) * 3;
    for (let i = start; i < idx.length; i += 3) {
      const [a, b, c] = [idx[i] * 3, idx[i + 1] * 3, idx[i + 2] * 3];
      const u = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
      const v = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
      const area = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
      assert.ok(area > 0, `${id} triangle ${i / 3} has area after quantization`);
    }
  }
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
