import * as THREE from 'three/webgpu';
import { hasProceduralMonument } from './monument-sites.js';
export { hasProceduralMonument } from './monument-sites.js';

// js/monuments.js
// Palacio de Cibeles retains origin's procedural architecture. The ten manifest monuments
// are exclusively supplied by js/monumentos.js (municipal or redesigned low-poly modules).

// Puerta de Alcalá is owned exclusively by js/monumentos/m-alcala.js. The earlier procedural
// gate and its separate pier colliders were retired to prevent two silhouettes at the same site.

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

const PROCEDURAL = {
  'Palacio de Cibeles': buildPalacioDeCibeles,
};

// Palacio de Cibeles is solid; Fuente de Cibeles belongs to the mesh loader.
export function buildProceduralColliders(name, lm) {
  if (!hasProceduralMonument(name)) return null;
  return [{ minX: lm.cx - lm.w / 2, maxX: lm.cx + lm.w / 2,
    minZ: lm.cz - lm.d / 2, maxZ: lm.cz + lm.d / 2, maxY: 72 }];
}

export function buildProceduralMonument(name, mat, lm) {
  const fn = hasProceduralMonument(name) && PROCEDURAL[name];
  return fn ? fn(mat, lm) : null;
}
