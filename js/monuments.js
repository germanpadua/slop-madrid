import * as THREE from 'three/webgpu';

// js/monuments.js
// Procedural, stylized-but-recognizable Madrid monuments. The municipal i3s LOD2 model
// was verified NOT to contain monument structures (MADRID.md, 2026-10-28), so the key
// landmarks are hand-modelled from public photographic references. Own work, no licensing
// friction, coherent with the game's look.

// Puerta de Alcalá (Sabater, 1778): 5 openings - 3 semicircular arches (central larger)
// + 2 linteled outer doors; attic over the central body. Real size ~43.9 m wide (ring
// long axis) x 21.9 m tall (OSM height) x ~14 m deep.
function buildPuertaDeAlcala(mat) {
  const W = 42.9, H = 21.9, D = 14;
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, 0);
  shape.lineTo(W / 2, 0);
  shape.lineTo(W / 2, 19);
  shape.lineTo(7, 19);
  shape.lineTo(7, H);
  shape.lineTo(-7, H);
  shape.lineTo(-7, 19);
  shape.lineTo(-W / 2, 19);
  shape.closePath();

  const archHole = (cx, w, springY) => {
    const p = new THREE.Path();
    const r = w / 2;
    p.moveTo(cx - r, 0);
    p.lineTo(cx - r, springY);
    p.absarc(cx, springY, r, Math.PI, 0, true);
    p.lineTo(cx + r, 0);
    p.closePath();
    return p;
  };
  const doorHole = (cx, w, h) => {
    const p = new THREE.Path();
    p.moveTo(cx - w / 2, 0);
    p.lineTo(cx - w / 2, h);
    p.lineTo(cx + w / 2, h);
    p.lineTo(cx + w / 2, 0);
    p.closePath();
    return p;
  };
  const OPENINGS = [
    { cx: 0, w: 6, top: 14 },      // central arch (spring 11, r 3)
    { cx: -9, w: 5, top: 12 },     // side arches (spring 9.5, r 2.5)
    { cx: 9, w: 5, top: 12 },
    { cx: -16.8, w: 4, top: 8 },   // linteled outer doors
    { cx: 16.8, w: 4, top: 8 },
  ];
  shape.holes.push(archHole(0, 6, 11));
  shape.holes.push(archHole(-9, 5, 9.5));
  shape.holes.push(archHole(9, 5, 9.5));
  shape.holes.push(doorHole(-16.8, 4, 8));
  shape.holes.push(doorHole(16.8, 4, 8));

  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false }), mat);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Open passage lining: thin dark jamb + soffit panels inside every vano, OPEN at
  // both ends - real passage (you can see and walk through), interior surfaces read
  // as shadow so the openings stay legible from oblique angles in flat midday light.
  const linerMat = new THREE.MeshStandardNodeMaterial({ color: 0x2c2823, roughness: 1, metalness: 0 });
  for (const o of OPENINGS) {
    for (const side of [-1, 1]) { // jambs
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.12, o.top, D - 0.3), linerMat);
      jamb.position.set(o.cx + side * (o.w / 2 - 0.06), o.top / 2, D / 2);
      g.add(jamb);
    }
    const soffit = new THREE.Mesh(new THREE.BoxGeometry(o.w - 0.1, 0.12, D - 0.3), linerMat);
    soffit.position.set(o.cx, o.top - 0.06, D / 2);
    g.add(soffit);
  }

  // Pilasters flanking the bays, on both facades (the real gate has paired columns
  // on pedestals; pilaster strips keep the game-style low-poly read).
  const detailMat = new THREE.MeshStandardNodeMaterial({ color: 0xefe9dc, roughness: 0.66, metalness: 0.03 });
  for (const px of [-20.5, -13.1, -4.9, 4.9, 13.1, 20.5]) {
    for (const pz of [-0.35, D + 0.35]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(1.6, 17.8, 0.7), detailMat);
      pil.position.set(px, 1.2 + 17.8 / 2, pz);
      pil.castShadow = true;
      g.add(pil);
    }
  }

  // Main cornice running the full width at the y=19 crown line.
  const cornice = new THREE.Mesh(new THREE.BoxGeometry(W + 1.0, 0.9, D + 1.0), detailMat);
  cornice.position.set(0, 18.95, D / 2);
  cornice.castShadow = true;
  g.add(cornice);

  // Attic inscription band (darker recessed stone) on both attic faces.
  const bandMat = new THREE.MeshStandardNodeMaterial({ color: 0xb9ad97, roughness: 0.8, metalness: 0.02 });
  for (const bz of [-0.15, D + 0.15]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(11, 1.3, 0.3), bandMat);
    band.position.set(0, 20.3, bz);
    g.add(band);
  }

  // Roofline read (reference-grounded): balustrade strips over the side sections,
  // corner urns on the y=19 crown, and a low-poly sculptural cluster crowning the
  // central attic - the top silhouette that makes it read as La Puerta, not a wall.
  for (const seg of [[-21.45, -7], [7, 21.45]]) {
    for (const bz of [-0.125, D + 0.125]) {
      const bal = new THREE.Mesh(new THREE.BoxGeometry(seg[1] - seg[0], 0.8, 0.25), detailMat);
      bal.position.set((seg[0] + seg[1]) / 2, 19.4 + 0.4, bz);
      g.add(bal);
    }
  }
  const urnGeo = new THREE.CylinderGeometry(0.28, 0.38, 1.1, 8);
  for (const ux of [-20.5, 20.5]) {
    for (const uz of [0.4, D - 0.4]) {
      const urn = new THREE.Mesh(urnGeo, detailMat);
      urn.position.set(ux, 19.9 + 0.55, uz);
      urn.castShadow = true;
      g.add(urn);
    }
  }
  const clusterMat = detailMat;
  const cluster = [[0, 1.5, 1.5, 1.3, 0], [-1.5, 1.0, 1.0, 0.9, -1.1], [1.5, 1.0, 1.0, 0.9, 1.1]];
  for (const [cx, cw, ch, cd, cz] of cluster) {
    const piece = new THREE.Mesh(new THREE.BoxGeometry(cw, ch * 1.6, cd), clusterMat);
    piece.position.set(cx, H + (ch * 1.6) / 2, D / 2 + cz);
    piece.castShadow = true;
    g.add(piece);
  }

  // Granite plinth (zócalo berroqueño), slightly wider than the body
  const plinthMat = new THREE.MeshStandardNodeMaterial({ color: 0x8d8272, roughness: 0.85, metalness: 0.02 });
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(W + 2, 1.2, D + 2), plinthMat);
  plinth.position.set(0, 0.6, D / 2);
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  g.add(plinth);

  g.rotation.y = Math.PI / 2; // facade width -> world Z (the ring's long axis), depth -> world X
  return g;
}


// Palacio de Cibeles (Palacios & Otamendi, 1919): the white "catedral de las
// Comunicaciones" - neoplateresco 5-floor body (~28 m) on the real OSM footprint,
// two pentagonal towers flanking the chamfered main facade toward the fountain,
// octagonal clock cimborrio over the crossing (real height 70 m), dark pizarra
// spires, corner pinnacles, and the columned portico on the Paseo del Prado side.
// Coordinates: local (lx = ring_x - cx, lz = ring_z - cz), shapes in (x, -z) so
// rotateX(-PI/2) maps them to true (x, z) - the city-grid.js:222 convention.
function buildPalacioDeCibeles(mat, lm) {
  const g = new THREE.Group();
  const trimMat = new THREE.MeshStandardNodeMaterial({ color: 0xf0ebdf, roughness: 0.62, metalness: 0.03 });
  const slateMat = new THREE.MeshStandardNodeMaterial({ color: 0x46423e, roughness: 0.6, metalness: 0.08 });
  const plinthMat = new THREE.MeshStandardNodeMaterial({ color: 0x8d8272, roughness: 0.85, metalness: 0.02 });

  const ringShape = (scale, ox, oz) => {
    const s = new THREE.Shape();
    const n = lm.ring.length / 2;
    for (let i = 0; i < n; i++) {
      const lx = (lm.ring[i * 2] - lm.cx) * scale + (ox || 0);
      const lz = -((lm.ring[i * 2 + 1] - lm.cz) * scale + (oz || 0));
      if (i === 0) s.moveTo(lx, lz); else s.lineTo(lx, lz);
    }
    s.closePath();
    return s;
  };
  const slab = (shape, y0, h, m) => {
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, y0, 0), m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  // Granite plinth, main 5-floor body, recessed upper tier, cornices at both crown lines.
  g.add(slab(ringShape(1.03), 0, 1.2, plinthMat));
  g.add(slab(ringShape(1), 0, 28, mat));
  g.add(slab(ringShape(1.015), 27.1, 0.9, trimMat));   // main cornice
  g.add(slab(ringShape(0.8), 28, 10, mat));            // recessed upper body
  g.add(slab(ringShape(0.815), 37.1, 0.9, trimMat));   // upper cornice

  // Two pentagonal towers flanking the chamfered main facade (ring corners facing
  // the fountain): local (-38.5, -4) and (-54.8, +9.5), body to y=50, slate spires.
  const towerGeo = new THREE.CylinderGeometry(6.2, 7.0, 50, 5);
  const spireGeo = new THREE.ConeGeometry(4.6, 8, 5);
  for (const [tx, tz] of [[-38.5, -4], [-54.8, 9.5]]) {
    const tower = new THREE.Mesh(towerGeo, mat);
    tower.position.set(tx, 25, tz);
    tower.castShadow = true;
    g.add(tower);
    const spire = new THREE.Mesh(spireGeo, slateMat);
    spire.position.set(tx, 50 + 4, tz);
    spire.castShadow = true;
    g.add(spire);
  }

  // Octagonal clock cimborrio over the crossing: drum 38->58, clock band, slate spire to 72.
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(9, 10, 20, 8), mat);
  drum.position.set(-12, 38 + 10, 2);
  drum.castShadow = true;
  g.add(drum);
  const clock = new THREE.Mesh(new THREE.CylinderGeometry(9.3, 9.3, 3, 8), trimMat);
  clock.position.set(-12, 55, 2);
  g.add(clock);
  const cimborrioSpire = new THREE.Mesh(new THREE.ConeGeometry(6.5, 14, 8), slateMat);
  cimborrioSpire.position.set(-12, 58 + 7, 2);
  cimborrioSpire.castShadow = true;
  g.add(cimborrioSpire);

  // White pinnacles on the two far corners of the main body (NE and SE).
  const pinGeo = new THREE.ConeGeometry(1.6, 6, 6);
  for (const [px, pz] of [[56, 62], [57, -60]]) {
    const pin = new THREE.Mesh(pinGeo, trimMat);
    pin.position.set(px, 28 + 3, pz);
    g.add(pin);
  }

  // Portico on the Paseo del Prado side (east face, lx ~ +59.5): 8 columns + entablature.
  const colGeo = new THREE.CylinderGeometry(0.5, 0.55, 9, 8);
  for (let i = 0; i < 8; i++) {
    const col = new THREE.Mesh(colGeo, mat);
    col.position.set(59.5, 4.5, -30 + i * 6);
    col.castShadow = true;
    g.add(col);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 48), trimMat);
  beam.position.set(59.5, 9.6, -9);
  beam.castShadow = true;
  g.add(beam);

  return g;
}

const PROCEDURAL = {
  'Puerta de Alcalá': buildPuertaDeAlcala,
  'Palacio de Cibeles': buildPalacioDeCibeles,
};

// Collision for procedural monuments: solid piers only, openings stay passable.
// World mapping after rotation.y=PI/2: local (x,z) -> world (z,-x); the body spans
// world x in [cx, cx+D] and world z in [cz-21.45, cz+21.45]. (The old whole-site
// bbox was also misaligned by D/2 in x and sealed the arches.)
const PUERTA_PIERS = [[-21.45, -18.8], [-14.8, -11.5], [-6.5, -3], [3, 6.5], [11.5, 14.8], [18.8, 21.45]];
export function buildProceduralColliders(name, lm) {
  if (name === 'Palacio de Cibeles') {
    // Solid building: full footprint bbox, tall enough for the cimborrio spire (72 m).
    return [{ minX: lm.cx - lm.w / 2, maxX: lm.cx + lm.w / 2, minZ: lm.cz - lm.d / 2, maxZ: lm.cz + lm.d / 2, maxY: 72 }];
  }
  if (name !== 'Puerta de Alcalá') return null;
  const D = 14;
  return PUERTA_PIERS.map(([a, b]) => ({
    minX: lm.cx, maxX: lm.cx + D,
    minZ: lm.cz - b, maxZ: lm.cz - a,
    maxY: 21.9,
  }));
}

export function buildProceduralMonument(name, mat, lm) {
  const fn = PROCEDURAL[name];
  return fn ? fn(mat, lm) : null;
}
