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
  // Clean the OSM ring once: metre-scale jags (backtracking zigzags) make the
  // extrusion self-intersect and break wall faces nearby.
  const clean = (() => {
    const out = [];
    const n = lm.ring.length / 2;
    for (let i = 0; i < n; i++) {
      const x = lm.ring[i * 2] - lm.cx, z = -(lm.ring[i * 2 + 1] - lm.cz);
      const p = out[out.length - 1];
      if (p && Math.hypot(x - p[0], z - p[1]) < 2.5) continue;
      out.push([x, z]);
    }
    // also drop a closing point that duplicates the first
    if (out.length > 2) {
      const f = out[0], l = out[out.length - 1];
      if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 2.5) out.pop();
    }
    return out;
  })();
  const ringShape = (scale) => {
    const sh = new THREE.Shape();
    for (let i = 0; i < clean.length; i++) {
      const lx = clean[i][0] * scale, lz = clean[i][1] * scale;
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
    const n = clean.length;
    const pts = clean.map(([x, z]) => [x * scale, -z * scale]);
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
  // Tier shape for stepped towers: anisotropic centroid scaling (sx < sz):
  // tiers narrow mostly in width (broad lower wings, narrow central raised mass)
  // while keeping nearly full depth. Front-plane anchoring was tried and rejected:
  // on concave/crescent footprints it inverts segments (bowtie extrusion).
  const tierShape = (sx, sz) => {
    const sh = new THREE.Shape();
    for (let i = 0; i < clean.length; i++) {
      const lx = clean[i][0] * sx, lz = clean[i][1] * sz;
      if (i === 0) sh.moveTo(lx, lz); else sh.lineTo(lx, lz);
    }
    sh.closePath();
    return sh;
  };
  // Punched-window grid: one dark quad per window opening, per floor, following the
  // real ring segment by segment. Merged to a single draw call by batchStaticGroupMeshes.
  const addWindowGrid = (g, y0, y1, mat, { spacing = 3.4, floorH = 3.6, winW = 1.5, winH = 2.0, sx = 1, sz = 1 } = {}) => {
    const n = clean.length;
    const pts = clean.map(([x, z]) => [x * sx, z * sz]);
    for (let i = 0; i < n; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % n];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < spacing * 1.5) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      let nx = -dz, nz = dx;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
      const ang = Math.atan2(nx, nz);
      const cols = Math.floor(len / spacing);
      const rows = Math.floor((y1 - y0) / floorH);
      for (let c = 0; c < cols; c++) {
        const t = (c + 0.5) / cols;
        const wx = ax + (bx - ax) * t + nx * 0.08, wz = az + (bz - az) * t + nz * 0.08;
        for (let r = 0; r < rows; r++) {
          const wy = y0 + (r + 0.5) * ((y1 - y0) / rows);
          const q = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), mat);
          q.position.set(wx, wy, wz);
          q.rotation.y = ang;
          q.castShadow = false;
          q.receiveShadow = false;
          g.add(q);
        }
      }
    }
  };
  return { ringShape, slab, addVerticalStrips, tierShape, addWindowGrid };
}

// Edificio España (Julián & José María Otamendi, 1953): 117 m, 25-26 plantas,
// neobarroco/neoherreriano; ladrillo visto + piedra caliza. Defining silhouette per
// esmadrid/Wikipedia: "fachada escalonada en cuatro alturas" - four stepped tiers,
// symmetric, caliza base, over the real (roughly rectangular) plaza-fronting footprint.
function buildEdificioEspana(mat, lm) {
  const g = new THREE.Group();
  const { ringShape, slab, tierShape, addWindowGrid } = ringTools(lm);
  const brickMat = new THREE.MeshStandardNodeMaterial({ color: 0x9c5a41, roughness: 0.82, metalness: 0.02, side: THREE.DoubleSide });
  const trimMat = new THREE.MeshStandardNodeMaterial({ color: 0xe8dfca, roughness: 0.66, metalness: 0.03, side: THREE.DoubleSide });
  const plinthMat = new THREE.MeshStandardNodeMaterial({ color: 0x8d8272, roughness: 0.85, metalness: 0.02, side: THREE.DoubleSide });
  const openMat = new THREE.MeshStandardNodeMaterial({ color: 0x3a352e, roughness: 1, metalness: 0 });
  const H = Math.min(lm.h || 108, 117);

  g.add(slab(ringShape(1.02), 0, 1.4, plinthMat));
  // Caliza base (arcade + mezzanine), then brick body stepping in four heights:
  // tiers narrow symmetric in x (broad lower wings, narrow central mass) while the
  // plaza front plane stays fixed; depth shrinks toward the rear.
  g.add(slab(ringShape(1.0), 0, 9, trimMat));
  g.add(slab(tierShape(1.0, 1.0), 9, 23, brickMat));      // height 1: 9-32, full footprint
  g.add(slab(tierShape(1.0, 1.0), 31.4, 0.9, trimMat));   // cornice
  g.add(slab(tierShape(0.86, 0.95), 32, 24, brickMat));   // height 2: 32-56
  g.add(slab(tierShape(0.87, 0.96), 55.4, 0.9, trimMat));
  g.add(slab(tierShape(0.7, 0.85), 56, 24, brickMat));    // height 3: 56-80
  g.add(slab(tierShape(0.71, 0.86), 79.4, 0.9, trimMat));
  g.add(slab(tierShape(0.48, 0.7), 80, H - 80, brickMat));// height 4: central tower to H
  g.add(slab(tierShape(0.5, 0.72), H - 0.6, 0.9, trimMat));
  // Neobarroque crown: tempietto + cap over the central tower
  const crown = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 10), trimMat);
  crown.position.set(0, H + 2.2, 0);
  crown.castShadow = true;
  g.add(crown);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(6.4, 3.2, 4), brickMat);
  cap.rotation.y = Math.PI / 4;
  cap.position.set(0, H + 6.2, 0);
  cap.castShadow = true;
  g.add(cap);

  // PARKED (open issue): punched window grids render detached from the outer-arc
  // segments of this crescent footprint from some angles (harness front view).
  // Massing (four alturas, anisotropic tiers) validated; window articulation pending.
  // addWindowGrid(g, 10, 30.5, openMat, { spacing: 3.4, winW: 1.6, winH: 2.1 });
  // addWindowGrid(g, 33, 54.5, openMat, { spacing: 3.4, winW: 1.6, winH: 2.1, sx: 0.86, sz: 0.95 });
  // addWindowGrid(g, 57, 78.5, openMat, { spacing: 3.3, winW: 1.5, winH: 2.1, sx: 0.7, sz: 0.85 });
  // addWindowGrid(g, 81, H - 3, openMat, { spacing: 3.2, winW: 1.5, winH: 2.0, sx: 0.48, sz: 0.7 });
  // addWindowGrid(g, 1.6, 8.4, openMat, { spacing: 4.2, floorH: 6.8, winW: 2.2, winH: 4.6 });
  // Central stone frontispiece hint on the plaza facade (longest ring segment)
  {
    const n = lm.ring.length / 2;
    let best = 0, bestLen = 0;
    for (let i = 0; i < n; i++) {
      const ax = lm.ring[i * 2] - lm.cx, az = -(lm.ring[i * 2 + 1] - lm.cz);
      const bx = lm.ring[((i + 1) % n) * 2] - lm.cx, bz = -(lm.ring[((i + 1) % n) * 2 + 1] - lm.cz);
      const L = Math.hypot(bx - ax, bz - az);
      if (L > bestLen) { bestLen = L; best = i; }
    }
    const ax = lm.ring[best * 2] - lm.cx, az = -(lm.ring[best * 2 + 1] - lm.cz);
    const bx = lm.ring[((best + 1) % n) * 2] - lm.cx, bz = -(lm.ring[((best + 1) % n) * 2 + 1] - lm.cz);
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const dx = (bx - ax) / bestLen, dz = (bz - az) / bestLen;
    let nx = -dz, nz = dx;
    if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
    const front = new THREE.Mesh(new THREE.BoxGeometry(13, 24, 1.1), trimMat);
    front.position.set(mx + nx * 0.55, 21, mz + nz * 0.55);
    front.rotation.y = Math.atan2(nx, nz);
    front.castShadow = true;
    g.add(front);
    const ped = new THREE.Mesh(new THREE.BoxGeometry(15, 1.4, 1.6), trimMat);
    ped.position.set(mx + nx * 0.7, 33.4, mz + nz * 0.7);
    ped.rotation.y = Math.atan2(nx, nz);
    ped.castShadow = true;
    g.add(ped);
  }
  return g;
}

// Torre de Madrid (Otamendi, 1957): 142 m, 34 plantas, hormigón blanco; chaflán plan
// with diagonal symmetry. Defining features per patrimonioypaisaje.madrid.es (official):
// "entramado ascensional con resaltes" (vertical strip framework), "énfasis en las
// esquinas con el juego de terrazas voladas" (flying corner terraces), "remate con una
// amplia cornisa" (wide crown cornice), aesthetic "desornamentada, moderna y funcional".
function buildTorreDeMadrid(mat, lm) {
  const g = new THREE.Group();
  const { ringShape, slab, addWindowGrid } = ringTools(lm);
  const concreteMat = new THREE.MeshStandardNodeMaterial({ color: 0xdcd7cb, roughness: 0.7, metalness: 0.04, side: THREE.DoubleSide });
  const trimMat = new THREE.MeshStandardNodeMaterial({ color: 0xefece3, roughness: 0.6, metalness: 0.04 });
  const plinthMat = new THREE.MeshStandardNodeMaterial({ color: 0x8d8272, roughness: 0.85, metalness: 0.02 });
  const openMat = new THREE.MeshStandardNodeMaterial({ color: 0x4a545e, roughness: 0.9, metalness: 0.05 });
  const H = Math.min(lm.h || 128, 142);

  g.add(slab(ringShape(1.02), 0, 1.4, plinthMat));
  // Commercial base (the lower annex wing is a separate OSM building: named LOD abstraction)
  g.add(slab(ringShape(1.0), 0, 11, concreteMat));
  addWindowGrid(g, 1.6, 10.2, openMat, { spacing: 4.0, floorH: 8.6, winW: 2.4, winH: 5.4 });
  // Main white prism: window slots per floor between white piers (the real articulation
  // is a white grid of piers + spandrels, not continuous fluting)
  g.add(slab(ringShape(1.0), 11, H - 14, concreteMat));
  addWindowGrid(g, 12, H - 15, openMat, { spacing: 3.1, floorH: 3.3, winW: 1.7, winH: 2.3 });
  // Flying corner terraces: small white slabs protruding at the footprint extremes at
  // EVERY floor (the serrated corner profile the official description emphasizes)
  {
    const n = lm.ring.length / 2;
    const corners = [];
    for (let i = 0; i < n; i++) corners.push([lm.ring[i * 2] - lm.cx, lm.ring[i * 2 + 1] - lm.cz]);
    corners.sort((a, b) => (b[0] * b[0] + b[1] * b[1]) - (a[0] * a[0] + a[1] * a[1]));
    for (const [vx0, vz0] of corners.slice(0, 4)) {
      const vx = vx0, vz = -vz0;
      const len = Math.hypot(vx, vz) || 1;
      const ox = vx / len, oz = vz / len;
      for (let y = 13; y < H - 15; y += 3.3) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 2.6), trimMat);
        t.position.set(vx + ox * 1.1, y, vz + oz * 1.1);
        t.castShadow = false;
        g.add(t);
      }
    }
  }
  // Wide crown cornice + recessed penthouse (the real remate)
  g.add(slab(ringShape(1.04), H - 3, 2.2, trimMat));
  g.add(slab(ringShape(0.82), H - 0.8, 3.4, concreteMat));
  return g;
}


// Templo de Debod (Nubian temple, rebuilt in Parque del Cuartel de la Montaña, 1972).
// Reference-grounded (Wikimedia Commons photos; madrid.es: complex ~70 m long, 270 m2):
// sandstone hall + columned porch, two trapezoidal pylon gateways on the same axis,
// stone podium over a reflecting pool. The OSM ring is the SITE (pool) outline -
// the generic path wrongly extruded it ~24 m; this builder replaces that with the real composition.
function buildTemploDeDebod(mat, lm) {
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardNodeMaterial({ color: 0xb59a72, roughness: 0.85, metalness: 0.02 });
  const pylonMat = new THREE.MeshStandardNodeMaterial({ color: 0xa78a60, roughness: 0.9, metalness: 0.02 });
  const podiumMat = new THREE.MeshStandardNodeMaterial({ color: 0xa9a193, roughness: 0.85, metalness: 0.02 });
  const waterMat = new THREE.MeshStandardNodeMaterial({ color: 0x35484a, roughness: 0.35, metalness: 0.15 });
  const darkMat = new THREE.MeshStandardNodeMaterial({ color: 0x2a241c, roughness: 1, metalness: 0 });

  // Main axis = PCA of the site ring points (the ring is L-shaped; the farthest-pair
  // diagonal misplaces the composition).
  const pts = [];
  for (let i = 0; i < lm.ring.length / 2; i++) pts.push([lm.ring[i * 2] - lm.cx, -(lm.ring[i * 2 + 1] - lm.cz)]);
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n, mz = pts.reduce((a, p) => a + p[1], 0) / n;
  const sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  const szz = pts.reduce((a, p) => a + (p[1] - mz) ** 2, 0);
  const sxz = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - mz), 0);
  const theta = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const u = [Math.cos(theta), Math.sin(theta)];
  const v = [-u[1], u[0]];
  const byU = [...pts].sort((a, b) => (a[0] * u[0] + a[1] * u[1]) - (b[0] * u[0] + b[1] * u[1]));
  const ends = [byU[0], byU[1], byU[n - 2], byU[n - 1]];
  const mid = [ends.reduce((a, p) => a + p[0], 0) / 4, ends.reduce((a, p) => a + p[1], 0) / 4];
  const L = 74; // real complex is ~70 m long (madrid.es)
  const at = (t, w) => [mid[0] + u[0] * t + v[0] * w, mid[1] + u[1] * t + v[1] * w];
  const angU = Math.atan2(u[0], u[1]); // yaw aligning +z to u
  g.userData.axisU = u; // harness: reference-aligned camera
  const place = (mesh, t, w, y) => {
    const [x, z] = at(t, w);
    mesh.position.set(x, y, z);
    mesh.rotation.y = angU; // box z-length maps to axis u, NO extra yaw
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const POD = 1.2;
  const halfLen = L / 2;
  const Lu = L + 8; // basin length along the axis

  // Rectangular site apron + rectangular water basin as a 4-slab frame around the
  // island podium (the L-shaped site ring triangulated into visible wedges).
  place(new THREE.Mesh(new THREE.BoxGeometry(30, 0.1, Lu + 12), podiumMat), 0, 0, 0.05).castShadow = false;
  for (const ws of [-1, 1]) {
    const w1 = new THREE.Mesh(new THREE.BoxGeometry(2, 0.14, Lu), waterMat);
    w1.castShadow = false; place(w1, 0, ws * 10, 0.17);
    const w2 = new THREE.Mesh(new THREE.BoxGeometry(18, 0.14, 2), waterMat);
    w2.castShadow = false; place(w2, ws * (Lu / 2 - 1), 0, 0.17);
  }
  // Island podium
  place(new THREE.Mesh(new THREE.BoxGeometry(18, 1.1, L + 4), podiumMat), 0, 0, 0.65);

  // Temple hall: long sandstone box + overhanging roof slab + raised naos
  const hallL = 26, hallW = 9.5, hallH = 7.5, tHall = 0.32 * halfLen;
  place(new THREE.Mesh(new THREE.BoxGeometry(hallW, hallH, hallL), stoneMat), tHall, 0, POD + hallH / 2);
  place(new THREE.Mesh(new THREE.BoxGeometry(hallW + 1.1, 0.7, hallL + 3.6), stoneMat), tHall - 1.25, 0, POD + hallH + 0.35); // roof overhang covers the columned porch (canonical silhouette)
  place(new THREE.Mesh(new THREE.BoxGeometry(8, 2.2, 8), stoneMat), tHall + hallL / 2 - 4.5, 0, POD + hallH + 1.8);
  // Columned porch on the face toward the pylons: shadowed recess behind 4 columns
  // + architrave + step, so the portico reads from the front (reference composition).
  const tFace = tHall - hallL / 2;
  place(new THREE.Mesh(new THREE.BoxGeometry(7.4, 4.8, 0.25), darkMat), tFace + 0.06, 0, POD + 2.4).castShadow = false;
  for (let c = 0; c < 4; c++) {
    place(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 4.6, 8), stoneMat), tFace - 1.3, -2.7 + c * 1.8, POD + 2.3);
  }
  place(new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.8, 1.4), stoneMat), tFace - 1.3, 0, POD + 4.9);
  place(new THREE.Mesh(new THREE.BoxGeometry(9, 0.35, 3.2), podiumMat), tFace - 1.2, 0, POD + 0.18);
  // Doorway slot on the recessed front wall
  place(new THREE.Mesh(new THREE.BoxGeometry(1.8, 4.4, 0.3), darkMat), tFace + 0.12, 0, POD + 2.2).castShadow = false;
  // Long-side window slots (three per side, small)
  for (const ws of [-1, 1]) for (let k = -1; k <= 1; k++) {
    place(new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.6, 1.9), darkMat), tHall + k * 6.5, ws * (hallW / 2 + 0.03), POD + 4.4).castShadow = false;
  }

  // Pylon gateways: rectangular battered piers (true open portal between two jamb
  // frusta) + rectangular lintel + cornice cap. BoxGeometry frusta keep flat faces
  // and crisp edges; a 4-segment cylinder read as a tapered round tower.
  const frustumBox = (botHalf, topHalf, h) => {
    const geo = new THREE.BoxGeometry(botHalf * 2, h, botHalf * 2).toNonIndexed();
    const p = geo.attributes.position, sc = topHalf / botHalf;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * sc); p.setZ(i, p.getZ(i) * sc); }
    geo.computeVertexNormals();
    return geo;
  };
  const pylon = (t, baseHalf, topHalf, h) => {
    const gap = 2.3; // open portal width
    const jw = (baseHalf * 2 - gap) / 2; // full jamb width at base
    const jwTop = jw * (topHalf / baseHalf);
    for (const js of [-1, 1]) {
      place(new THREE.Mesh(frustumBox(jw / 2, jwTop / 2, h), pylonMat), t, js * (gap / 2 + jw / 2), POD + h / 2);
    }
    // rectangular lintel spanning the portal + cornice cap
    place(new THREE.Mesh(new THREE.BoxGeometry(topHalf * 2 + 0.2, 1.5, topHalf * 2 + 0.2), pylonMat), t, 0, POD + h - 0.75);
    place(new THREE.Mesh(new THREE.BoxGeometry(topHalf * 2 + 0.8, 0.5, topHalf * 2 + 0.8), pylonMat), t, 0, POD + h + 0.25);
  };
  pylon(-0.22 * halfLen, 3.1, 2.5, 8.6);
  pylon(-0.58 * halfLen, 2.7, 2.2, 7.6);
  return g;
}

const PROCEDURAL = {
  // PARKED PROTOTYPES (visual validation open - kept out of the default render path):
  // 'Edificio España': buildEdificioEspana,   // window-grid detachment on crescent outer arc; massing not reference-validated
  // 'Torre de Madrid': buildTorreDeMadrid,    // blank facade swath + terraces read as floating fins (parent review 2026-10-29)
  // 'Templo de Debod': buildTemploDeDebod,     // pylon/portal/basin geometry under correction (parent review 2026-10-29)

  'Puerta de Alcalá': buildPuertaDeAlcala,
  'Palacio de Cibeles': buildPalacioDeCibeles,
};

// Collision for procedural monuments: solid piers only, openings stay passable.
// World mapping after rotation.y=PI/2: local (x,z) -> world (z,-x); the body spans
// world x in [cx, cx+D] and world z in [cz-21.45, cz+21.45]. (The old whole-site
// bbox was also misaligned by D/2 in x and sealed the arches.)
const PUERTA_PIERS = [[-21.45, -18.8], [-14.8, -11.5], [-6.5, -3], [3, 6.5], [11.5, 14.8], [18.8, 21.45]];
export function buildProceduralColliders(name, lm) {
  if (name === 'Templo de Debod') {
    // Walkable podium and pool; collide only with the built masses (approx bboxes on the site bbox corners).
    return [{ minX: lm.cx - lm.w * 0.30, maxX: lm.cx + lm.w * 0.42, minZ: lm.cz - lm.d * 0.30, maxZ: lm.cz + lm.d * 0.30, maxY: 10 }];
  }
  if (PROCEDURAL[name] && (name === 'Edificio España' || name === 'Torre de Madrid')) {
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

// Harness-only access: parked prototypes stay renderable for pixel validation
// WITHOUT entering the default render path (PROCEDURAL above is the live gate).
const PROTOTYPES = {
  'Edificio España': buildEdificioEspana,
  'Torre de Madrid': buildTorreDeMadrid,
  'Templo de Debod': buildTemploDeDebod,
};
export function buildMonumentForReview(name, mat, lm) {
  const fn = PROCEDURAL[name] || PROTOTYPES[name];
  return fn ? fn(mat, lm) : null;
}
