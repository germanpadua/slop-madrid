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
// Comunicaciones". Reference-grounded (Patrimonio y Paisaje - Ayto. de Madrid;
// CentroCentro): 5-floor neoplateresco body on the real OSM footprint, regular
// window rhythm, main WEST facade onto Plaza de Cibeles with grand arched
// entrance, two pentagonal towers flanking that facade (dark pizarra spires),
// octagonal clock cimborrio over the crossing (70 m real), roofline pinnacles,
// columned portico on the Paseo del Prado (east) side.
// Coordinates: local (lx = ring_x - cx, lz = ring_z - cz); shapes in (x, -z) so
// rotateX(-PI/2) maps them to true (x, z) - the city-grid.js:222 convention.
function buildPalacioDeCibeles(mat, lm) {
  const g = new THREE.Group();
  const trimMat = new THREE.MeshStandardNodeMaterial({ color: 0xf0ebdf, roughness: 0.62, metalness: 0.03 });
  const slateMat = new THREE.MeshStandardNodeMaterial({ color: 0x46423e, roughness: 0.6, metalness: 0.08 });
  const plinthMat = new THREE.MeshStandardNodeMaterial({ color: 0x8d8272, roughness: 0.85, metalness: 0.02 });
  const openMat = new THREE.MeshStandardNodeMaterial({ color: 0x2f2b26, roughness: 1, metalness: 0 }); // openings read as shadow

  const ringShape = (scale) => {
    const s = new THREE.Shape();
    const n = lm.ring.length / 2;
    for (let i = 0; i < n; i++) {
      const lx = (lm.ring[i * 2] - lm.cx) * scale;
      const lz = -((lm.ring[i * 2 + 1] - lm.cz) * scale);
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

  // --- Window rhythm: dark recessed openings, 5 floors, following the REAL ring
  // wall segment by segment (handles the zigzag/chamfer; windows sit proud of the wall).
  const FLOORS = [4.5, 9.5, 14.5, 19.5, 24.5]; // window center heights
  const winGeo = new THREE.BoxGeometry(1.8, 2.8, 0.16);
  {
    const n = lm.ring.length / 2;
    const pts = [];
    for (let i = 0; i < n; i++) pts.push([lm.ring[i * 2] - lm.cx, lm.ring[i * 2 + 1] - lm.cz]);
    for (let i = 0; i < n; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % n];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 3) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      // outward normal: perpendicular pointing away from the footprint centroid (0,0)
      let nx = -dz, nz = dx;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
      const ang = Math.atan2(nx, nz);
      const cols = Math.floor(len / 4);
      for (let c = 0; c <= cols; c++) {
        const t = cols === 0 ? 0.5 : c / cols;
        const wx = ax + (bx - ax) * t, wz = az + (bz - az) * t;
        const westEntrance = nx < -0.5 && wz > 20 && wz < 40;
        const eastPortico = nx > 0.5 && wx > 55 && wz > -32 && wz < 16;
        for (const fy of FLOORS) {
          if ((westEntrance || eastPortico) && fy < 12) continue;
          const w = new THREE.Mesh(winGeo, openMat);
          w.position.set(wx + nx * 0.15, fy, wz + nz * 0.15);
          w.rotation.y = ang;
          g.add(w);
        }
      }
    }
  }

  // --- Grand entrance on the west face (triple-height arch group, trim surround).
  for (const ez of [25, 30, 35]) {
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.5, 12, 1, false, 0, Math.PI), trimMat);
    arch.rotation.z = Math.PI / 2; arch.rotation.y = Math.PI / 2;
    arch.position.set(-56.3, 8, ez);
    g.add(arch);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.3, 8, 3.6), openMat);
    door.position.set(-56.5, 4 + 1.2, ez);
    g.add(door);
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 4.4), plinthMat);
    step.position.set(-57.6, 0.25 + 1.2, ez);
    g.add(step);
  }

  // --- Two pentagonal towers flanking the WEST facade (one at each end),
  // full height from the ground, arched gallery band, slate spire.
  const towerGeo = new THREE.CylinderGeometry(6.2, 7.0, 46, 5);
  const galleryGeo = new THREE.CylinderGeometry(5.6, 5.6, 4, 5);
  const spireGeo = new THREE.ConeGeometry(4.6, 10, 5);
  for (const [tx, tz] of [[-56.5, 50], [-53.5, 6]]) {
    const tower = new THREE.Mesh(towerGeo, mat);
    tower.position.set(tx, 23, tz);
    tower.castShadow = true;
    g.add(tower);
    const gallery = new THREE.Mesh(galleryGeo, openMat); // dark arched gallery band
    gallery.position.set(tx, 42, tz);
    g.add(gallery);
    const trim = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 6.4, 0.8, 5), trimMat);
    trim.position.set(tx, 44.5, tz);
    g.add(trim);
    const spire = new THREE.Mesh(spireGeo, slateMat);
    spire.position.set(tx, 46 + 5, tz);
    spire.castShadow = true;
    g.add(spire);
  }

  // --- Octagonal clock cimborrio over the crossing: drum, open colonnade,
  // clock stage with 4 dark faces, small drum, slate spire. Tip at 72 (real 70).
  const cimbX = -12, cimbZ = 2;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(9, 10, 14, 8), mat);
  drum.position.set(cimbX, 38 + 7, cimbZ);
  drum.castShadow = true;
  g.add(drum);
  for (let i = 0; i < 8; i++) { // colonnade band
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 4, 6), trimMat);
    col.position.set(cimbX + Math.sin(a) * 8.2, 52 + 2, cimbZ + Math.cos(a) * 8.2);
    g.add(col);
  }
  const clockStage = new THREE.Mesh(new THREE.CylinderGeometry(8.6, 8.6, 4.5, 8), mat);
  clockStage.position.set(cimbX, 56 + 2.25, cimbZ);
  clockStage.castShadow = true;
  g.add(clockStage);
  const clockGeo = new THREE.CylinderGeometry(2.6, 2.6, 0.3, 16);
  for (let i = 0; i < 4; i++) { // dark clock faces on the cardinal sides
    const a = (i / 4) * Math.PI * 2;
    const face = new THREE.Mesh(clockGeo, openMat);
    face.rotation.x = Math.PI / 2;
    face.rotation.z = -a;
    face.position.set(cimbX + Math.sin(a) * 8.7, 58.2, cimbZ + Math.cos(a) * 8.7);
    face.rotation.x = Math.PI / 2;
    g.add(face);
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.34, 8), trimMat);
    dial.rotation.x = Math.PI / 2;
    dial.position.set(cimbX + Math.sin(a) * 8.75, 58.2, cimbZ + Math.cos(a) * 8.75);
    g.add(dial);
  }
  const smallDrum = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 6.5, 3, 8), mat);
  smallDrum.position.set(cimbX, 60.5 + 1.5, cimbZ);
  g.add(smallDrum);
  const cimborrioSpire = new THREE.Mesh(new THREE.ConeGeometry(5.0, 9, 8), slateMat);
  cimborrioSpire.position.set(cimbX, 63.5 + 4.5, cimbZ);
  cimborrioSpire.castShadow = true;
  g.add(cimborrioSpire);

  // --- Roofline pinnacles (white obelisk cones) at the outer corners + south run.
  const pinGeo = new THREE.ConeGeometry(1.4, 5, 6);
  for (const [px, pz] of [[58, 64], [57, -64], [20, -57], [-46.5, 2.5]]) {
    const pin = new THREE.Mesh(pinGeo, trimMat);
    pin.position.set(px, 28 + 2.5, pz);
    g.add(pin);
  }

  // --- Portico on the Paseo del Prado side (east face): 8 columns + entablature + terrace.
  const colGeo = new THREE.CylinderGeometry(0.7, 0.75, 9, 8);
  for (let i = 0; i < 8; i++) {
    const col = new THREE.Mesh(colGeo, mat);
    col.position.set(61.5, 4.5 + 1.2, -30 + i * 6);
    col.castShadow = true;
    g.add(col);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 48), trimMat);
  beam.position.set(61.5, 10.3 + 1.2, -9);
  beam.castShadow = true;
  g.add(beam);
  const terrace = new THREE.Mesh(new THREE.BoxGeometry(6, 1.2, 50), plinthMat);
  terrace.position.set(60.5, 0.6, -9);
  g.add(terrace);

  return g;
}

// --- Plaza de España pair (Otamendi brothers) -------------------------------------
// Shared helper: footprint shape + slab extrusion along the REAL OSM ring (the
// city-grid.js:222 (x,-z)/rotateX(-PI/2) convention, same as buildPalacioDeCibeles).
function ringTools(lm) {
  const ringShape = (scale) => {
    const sh = new THREE.Shape();
    const n = lm.ring.length / 2;
    for (let i = 0; i < n; i++) {
      const lx = (lm.ring[i * 2] - lm.cx) * scale;
      const lz = -((lm.ring[i * 2 + 1] - lm.cz) * scale);
      if (i === 0) sh.moveTo(lx, lz); else sh.lineTo(lx, lz);
    }
    sh.closePath();
    return sh;
  };
  const slab = (shape, y0, h, m) => {
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, y0, 0), m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  // Vertical dark window strips standing slightly proud of the wall, following the
  // real ring segment by segment (handles chamfers/zigzags). Maqueta-scale rhythm,
  // one mesh per strip so batchStaticGroupMeshes merges them into few draw calls.
  const addVerticalStrips = (g, y0, y1, mat, spacing = 3.6, scale = 1.0, width = 0.75) => {
    const n = lm.ring.length / 2;
    const pts = [];
    for (let i = 0; i < n; i++) pts.push([(lm.ring[i * 2] - lm.cx) * scale, (lm.ring[i * 2 + 1] - lm.cz) * scale]);
    for (let i = 0; i < n; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % n];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 3) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      let nx = -dz, nz = dx;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
      const ang = Math.atan2(nx, nz);
      const cols = Math.floor(len / spacing);
      for (let c = 0; c <= cols; c++) {
        const t = cols === 0 ? 0.5 : (c + 0.5) / (cols + 1);
        const wx = ax + (bx - ax) * t, wz = az + (bz - az) * t;
        const strip = new THREE.Mesh(new THREE.BoxGeometry(width, y1 - y0, 0.16), mat);
        strip.position.set(wx + nx * 0.1, (y0 + y1) / 2, wz + nz * 0.1);
        strip.rotation.y = ang;
        strip.castShadow = false;
        strip.receiveShadow = false;
        g.add(strip);
      }
    }
  };
  return { ringShape, slab, addVerticalStrips };
}

// Edificio España (Julián & José María Otamendi, 1953): 117 m, 25-26 plantas,
// neobarroco/neoherreriano; ladrillo visto + piedra caliza. Defining silhouette per
// esmadrid/Wikipedia: "fachada escalonada en cuatro alturas" - four stepped tiers,
// symmetric, caliza base, over the real (roughly rectangular) plaza-fronting footprint.
function buildEdificioEspana(mat, lm) {
  const g = new THREE.Group();
  const { ringShape, slab, addVerticalStrips } = ringTools(lm);
  const brickMat = new THREE.MeshStandardNodeMaterial({ color: 0x9c5a41, roughness: 0.82, metalness: 0.02 });
  const trimMat = new THREE.MeshStandardNodeMaterial({ color: 0xe8dfca, roughness: 0.66, metalness: 0.03 });
  const plinthMat = new THREE.MeshStandardNodeMaterial({ color: 0x8d8272, roughness: 0.85, metalness: 0.02 });
  const openMat = new THREE.MeshStandardNodeMaterial({ color: 0x453d34, roughness: 1, metalness: 0 });
  const H = Math.min(lm.h || 108, 117);

  g.add(slab(ringShape(1.02), 0, 1.4, plinthMat));
  // Caliza base (commercial + mezzanine), then four stepped brick tiers.
  g.add(slab(ringShape(1.0), 0, 9, trimMat));
  g.add(slab(ringShape(1.0), 9, 23, brickMat));           // tier 1: 9-32
  g.add(slab(ringShape(1.012), 31.4, 0.9, trimMat));      // cornice
  g.add(slab(ringShape(0.88), 32, 26, brickMat));         // tier 2: 32-58
  g.add(slab(ringShape(0.892), 57.4, 0.9, trimMat));
  g.add(slab(ringShape(0.72), 58, 26, brickMat));         // tier 3: 58-84
  g.add(slab(ringShape(0.732), 83.4, 0.9, trimMat));
  g.add(slab(ringShape(0.5), 84, H - 84, brickMat));      // tier 4 (central tower)
  g.add(slab(ringShape(0.52), H - 0.6, 0.9, trimMat));    // crown cornice
  // Neobarroque crown hint: small tempietto over the central tier
  const crown = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 10), trimMat);
  crown.position.set(0, H + 2.2, 0);
  crown.castShadow = true;
  g.add(crown);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(6.4, 3.2, 4), brickMat);
  cap.rotation.y = Math.PI / 4;
  cap.position.set(0, H + 6.2, 0);
  cap.castShadow = true;
  g.add(cap);

  // Vertical window rhythm on the brick tiers (maqueta legibility; strips proud of wall)
  addVerticalStrips(g, 10, 31, openMat);
  addVerticalStrips(g, 33, 56, openMat, 3.6, 0.88);
  addVerticalStrips(g, 59, 82, openMat, 3.4, 0.72);
  addVerticalStrips(g, 85, H - 2, openMat, 3.2, 0.5);
  // Base: taller, darker shopfront band
  addVerticalStrips(g, 1.6, 8.4, openMat, 4.2);
  return g;
}

// Torre de Madrid (Otamendi, 1957): 142 m, 34 plantas, hormigón blanco; chaflán plan
// with diagonal symmetry. Defining features per patrimonioypaisaje.madrid.es (official):
// "entramado ascensional con resaltes" (vertical strip framework), "énfasis en las
// esquinas con el juego de terrazas voladas" (flying corner terraces), "remate con una
// amplia cornisa" (wide crown cornice), aesthetic "desornamentada, moderna y funcional".
function buildTorreDeMadrid(mat, lm) {
  const g = new THREE.Group();
  const { ringShape, slab, addVerticalStrips } = ringTools(lm);
  const concreteMat = new THREE.MeshStandardNodeMaterial({ color: 0xdcd7cb, roughness: 0.7, metalness: 0.04 });
  const trimMat = new THREE.MeshStandardNodeMaterial({ color: 0xefece3, roughness: 0.6, metalness: 0.04 });
  const plinthMat = new THREE.MeshStandardNodeMaterial({ color: 0x8d8272, roughness: 0.85, metalness: 0.02 });
  const openMat = new THREE.MeshStandardNodeMaterial({ color: 0x55606a, roughness: 0.9, metalness: 0.05 });
  const H = Math.min(lm.h || 128, 142);

  g.add(slab(ringShape(1.02), 0, 1.4, plinthMat));
  // Commercial base with dark shopfront band
  g.add(slab(ringShape(1.0), 0, 11, concreteMat));
  addVerticalStrips(g, 1.6, 10.2, openMat, 4.0);
  // Main white prism up to the crown
  g.add(slab(ringShape(1.0), 11, H - 14, concreteMat));
  addVerticalStrips(g, 12, H - 4.5, openMat, 3.2);
  // Flying corner terraces: small light slabs protruding at the footprint extremes,
  // stacked every ~12 m - the corner play the official description emphasizes.
  {
    const n = lm.ring.length / 2;
    const corners = [];
    for (let i = 0; i < n; i++) corners.push([lm.ring[i * 2] - lm.cx, lm.ring[i * 2 + 1] - lm.cz]);
    // the 4 vertices farthest from the centroid approximate the chamfered corners
    corners.sort((a, b) => (b[0] * b[0] + b[1] * b[1]) - (a[0] * a[0] + a[1] * a[1]));
    for (const [vx, vz] of corners.slice(0, 4)) {
      const len = Math.hypot(vx, vz) || 1;
      const ox = vx / len, oz = vz / len;
      for (let y = 24; y < H - 16; y += 12) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.55, 3.2), trimMat);
        t.position.set(vx + ox * 1.2, y, vz + oz * 1.2);
        t.castShadow = true;
        g.add(t);
      }
    }
  }
  // Wide crown cornice + recessed penthouse (the real remate)
  g.add(slab(ringShape(1.04), H - 3, 2.2, trimMat));
  g.add(slab(ringShape(0.82), H - 0.8, 3.4, concreteMat));
  return g;
}

const PROCEDURAL = {
  'Edificio España': buildEdificioEspana,
  'Torre de Madrid': buildTorreDeMadrid,

  'Puerta de Alcalá': buildPuertaDeAlcala,
  'Palacio de Cibeles': buildPalacioDeCibeles,
};

// Collision for procedural monuments: solid piers only, openings stay passable.
// World mapping after rotation.y=PI/2: local (x,z) -> world (z,-x); the body spans
// world x in [cx, cx+D] and world z in [cz-21.45, cz+21.45]. (The old whole-site
// bbox was also misaligned by D/2 in x and sealed the arches.)
const PUERTA_PIERS = [[-21.45, -18.8], [-14.8, -11.5], [-6.5, -3], [3, 6.5], [11.5, 14.8], [18.8, 21.45]];
export function buildProceduralColliders(name, lm) {
  if (name === 'Edificio España' || name === 'Torre de Madrid') {
    // Solid towers: full footprint bbox, up to the real tagged height.
    return [{ minX: lm.cx - lm.w / 2, maxX: lm.cx + lm.w / 2, minZ: lm.cz - lm.d / 2, maxZ: lm.cz + lm.d / 2, maxY: lm.h || 100 }];
  }
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
