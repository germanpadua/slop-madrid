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

const PROCEDURAL = {
  'Puerta de Alcalá': buildPuertaDeAlcala,
};

export function buildProceduralMonument(name, mat) {
  const fn = PROCEDURAL[name];
  return fn ? fn(mat) : null;
}
