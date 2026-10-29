import * as THREE from 'three/webgpu';
import { MADRID_LANDMARK_MASSES } from './madrid-landmark-masses.js';

// js/monuments.js
// Procedural, stylized-but-recognizable Madrid monuments. The municipal i3s LOD2 model
// was verified NOT to contain monument structures (MADRID.md, 2026-10-28), so the key
// landmarks are hand-modelled from public photographic references. Own work, no licensing
// friction, coherent with the game's look.

// Source parcel massing. Rings are world coordinates, clipped offline to the landmark.
export function buildSourcedLandmarkBody(name, lm, material) {
  const data = MADRID_LANDMARK_MASSES[name];
  if (!data) return null;
  const group = new THREE.Group();
  group.name = `SourcedBody:${name}`;
  const roofMat = new THREE.MeshStandardNodeMaterial({color: 0x9a9386, roughness: 1});
  const glassMat = new THREE.MeshStandardNodeMaterial({color: 0x739396, roughness: 0.85, metalness: 0});
  const shape = (part) => {
    const path = (ring, Type) => {
      const p = new Type();
      p.moveTo(ring[0]-lm.cx, -(ring[1]-lm.cz));
      for(let i=2;i<ring.length;i+=2) p.lineTo(ring[i]-lm.cx, -(ring[i+1]-lm.cz));
      p.closePath(); return p;
    };
    const p=path(part.ring, THREE.Shape);
    for(const hole of part.holes || []) p.holes.push(path(hole, THREE.Path));
    return p;
  };
  for(const part of data.parts) {
    const outline=shape(part);
    const bodyHeight=part.h-(part.roof?.height||0);
    const body=new THREE.Mesh(new THREE.ExtrudeGeometry(outline,{depth:bodyHeight,bevelEnabled:false}).rotateX(-Math.PI/2),material);
    body.castShadow=true; body.receiveShadow=true;
    // Landmark facade batching stores tint/body height in UVs.
    if(material.userData?.landmarkTint !== undefined) {
      const uv=body.geometry.attributes.uv;
      for(let i=0;i<uv.count;i++) uv.setXY(i,material.userData.landmarkTint+(data.facadeStorey||3.55)/20,bodyHeight);
    }
    group.add(body);
    if(part.roof) {
      const xs=part.ring.filter((_,i)=>i%2===0),zs=part.ring.filter((_,i)=>i%2===1);
      const x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs);
      const geometry=part.roof.shape==='dome'
        ? new THREE.SphereGeometry(1,24,12,0,Math.PI*2,0,Math.PI/2)
        : new THREE.ConeGeometry(1,1,4,1,false,Math.PI/4);
      const cap=new THREE.Mesh(geometry,new THREE.MeshStandardNodeMaterial({color:0x545e64,roughness:1}));
      cap.name=`MappedRoofProfile:${part.roof.osmWay}`;
      cap.position.set((x0+x1)/2-lm.cx,part.roof.shape==='dome'?bodyHeight:bodyHeight+part.roof.height/2,(z0+z1)/2-lm.cz);
      cap.scale.set((x1-x0)/(part.roof.shape==='dome'?2:Math.SQRT2),part.roof.height,(z1-z0)/(part.roof.shape==='dome'?2:Math.SQRT2));
      cap.castShadow=cap.receiveShadow=true;group.add(cap);
    } else {
      const roof=new THREE.Mesh(new THREE.ShapeGeometry(outline).rotateX(-Math.PI/2).translate(0,part.h+0.025,0),roofMat);
      roof.receiveShadow=true; group.add(roof);
    }
  }
  for(const part of data.roofParts||[]) {
    const xs=part.ring.filter((_,i)=>i%2===0),zs=part.ring.filter((_,i)=>i%2===1);
    const x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs);
    const cx=(x0+x1)/2-lm.cx,cz=(z0+z1)/2-lm.cz,base=part.h-part.roofHeight;
    const lantern=new THREE.Mesh(new THREE.CylinderGeometry((x1-x0)/2,(x1-x0)/2,base,8),material);
    lantern.position.set(cx,base/2,cz);group.add(lantern);
    const cap=new THREE.Mesh(new THREE.ConeGeometry(1,1,8),roofMat);
    cap.name=`MappedLantern:${part.osmWay}`;cap.position.set(cx,base+part.roofHeight/2,cz);
    cap.scale.set((x1-x0)/2,part.roofHeight,(z1-z0)/2);cap.castShadow=true;group.add(cap);
  }
  for(const part of data.glass) {
    const roof=new THREE.Mesh(new THREE.ShapeGeometry(shape(part)).rotateX(-Math.PI/2).translate(0,part.h+0.04,0),glassMat);
    roof.name=`MappedGlassRoof:${part.osmWay}`; group.add(roof);
  }
  return group;
}

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
// window rhythm, main NORTHWEST facade onto Plaza de Cibeles with grand arched
// entrance, two pentagonal towers flanking that facade (open galleries and pinnacles),
// octagonal clock cimborrio over the crossing (70 m real), roofline pinnacles,
// columned portico on the Paseo del Prado (west) side.
// Coordinates: local (lx = ring_x - cx, lz = ring_z - cz); shapes in (x, -z) so
// rotateX(-PI/2) maps them to true (x, z) - the city-grid.js:222 convention.
function buildPalacioDeCibeles(mat, lm) {
  const g = new THREE.Group();
  g.name = 'PalacioCibeles';
  const trimMat = new THREE.MeshStandardNodeMaterial({ color: 0xf0ebdf, roughness: 0.62, metalness: 0.03 });
  const slateMat = new THREE.MeshStandardNodeMaterial({ color: 0x46423e, roughness: 0.6, metalness: 0.08 });
  const plinthMat = new THREE.MeshStandardNodeMaterial({ color: 0x8d8272, roughness: 0.85, metalness: 0.02 });
  const openMat = new THREE.MeshStandardNodeMaterial({ color: 0x2f2b26, roughness: 1, metalness: 0 }); // openings read as shadow

  // The two small NW lobes of the supplied OSM ring bound the monumental frontage.
  // Use their bounds, not a west-facing axis-aligned facade invented independently of the site.
  // These anchors describe this source ring; their centres are illustrative tower placement,
  // not surveyed tower centres. See docs/validation/2026-10-29-cibeles-architecture.md.
  const lobeCenter = (first, last) => {
    const xs = [], zs = [];
    for (let i = first; i <= last; i++) {
      xs.push(lm.ring[i * 2] - lm.cx);
      zs.push(lm.ring[i * 2 + 1] - lm.cz);
    }
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
  };
  const southTower = lobeCenter(0, 6), northTower = lobeCenter(21, 28);
  const frontLength = Math.hypot(southTower.x - northTower.x, southTower.z - northTower.z);
  const tx = (southTower.x - northTower.x) / frontLength, tz = (southTower.z - northTower.z) / frontLength;
  const nx = -tz, nz = tx; // outward, toward the fountain / northwest
  const frontX = (southTower.x + northTower.x) / 2, frontZ = (southTower.z + northTower.z) / 2;
  const frontage = new THREE.Group();
  frontage.name = 'CibelesNorthwestFrontage';
  frontage.position.set(frontX, 0, frontZ);
  frontage.rotation.y = Math.atan2(nx, nz);
  g.add(frontage);

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

  // Preserve parcel heights, setbacks and mapped roof voids instead of a full-site slab.
  const sourcedBody=buildSourcedLandmarkBody('Palacio de Cibeles',lm,mat);
  if(sourcedBody) g.add(sourcedBody);

  // --- Window rhythm: dark recessed openings, 5 floors, following the REAL ring
  // wall segment by segment (handles the zigzag/chamfer; windows sit proud of the wall).
  const FLOORS = [4.5, 9.5, 14.5, 19.5, 24.5]; // window center heights
  const winGeo = new THREE.BoxGeometry(1.8, 3.8, 0.16);
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
        const entranceDistance = Math.hypot(wx - frontX, wz - frontZ);
        const northwestEntrance = entranceDistance < 7;
        for (const fy of FLOORS) {
          if (northwestEntrance && fy < 12) continue;
          const w = new THREE.Mesh(winGeo, openMat);
          w.position.set(wx + nx * 0.15, fy, wz + nz * 0.15);
          w.rotation.y = ang;
          g.add(w);
        }
      }
    }
  }

  // Central tall arched entrance and narrow upper window bays, seen in the official
  // frontal photograph. Relief, bay sizes and subdivisions remain low-poly symbols.
  const entrance = new THREE.Group();
  entrance.name = 'CibelesNorthwestEntrance';
  const archShape = new THREE.Shape();
  archShape.moveTo(-3, 0);
  archShape.lineTo(3, 0);
  archShape.lineTo(3, 7);
  archShape.absarc(0, 7, 3, 0, Math.PI, false);
  archShape.closePath();
  const door = new THREE.Mesh(new THREE.ExtrudeGeometry(archShape, { depth: 0.2, bevelEnabled: false }), openMat);
  door.position.set(0, 1.2, 0.3);
  entrance.add(door);
  for (const x of [-4, 4]) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(1.2, 27, 1.2), trimMat);
    pier.position.set(x, 13.5, 0.4);
    entrance.add(pier);
  }
  for (const x of [-2.5, 0, 2.5]) {
    const bay = new THREE.Mesh(new THREE.BoxGeometry(1.3, 5.2, 0.2), openMat);
    bay.position.set(x, 23, 0.4);
    entrance.add(bay);
  }
  const steps = new THREE.Mesh(new THREE.BoxGeometry(10, 1.2, 3), plinthMat);
  steps.position.set(0, 0.6, 1);
  entrance.add(steps);
  // Simplified central pavilion: portal surround, grouped bays and cornice.
  // Qualitative reading of the official frontal photograph; detail dimensions illustrative.
  const surround=new THREE.Shape();
  surround.moveTo(-4.8,0);surround.lineTo(4.8,0);surround.lineTo(4.8,7);
  surround.absarc(0,7,4.8,0,Math.PI,false);surround.closePath();
  const opening=new THREE.Path();opening.moveTo(-3,0);opening.lineTo(-3,7);
  opening.absarc(0,7,3,Math.PI,0,true);opening.lineTo(3,0);opening.closePath();surround.holes.push(opening);
  const portal=new THREE.Mesh(new THREE.ExtrudeGeometry(surround,{depth:0.65,bevelEnabled:false}),trimMat);
  portal.name='CibelesPortalSurround';portal.position.set(0,1.2,0.5);entrance.add(portal);
  for(const y of [15.5,21,26.5]) for(const x of [-2.5,0,2.5]) {
    const bay=new THREE.Mesh(new THREE.BoxGeometry(1.1,3.8,0.2),openMat);
    bay.position.set(x,y,0.65);entrance.add(bay);
  }
  for(const y of [12.8,18.3,23.8,29.3]) {
    const belt=new THREE.Mesh(new THREE.BoxGeometry(11,0.45,1.4),trimMat);
    belt.position.set(0,y,0.5);entrance.add(belt);
  }
  const pavilionCornice=new THREE.Mesh(new THREE.BoxGeometry(13,1.1,2),trimMat);
  pavilionCornice.position.set(0,31,0.3);entrance.add(pavilionCornice);
  frontage.add(entrance);

  // Pentagonal shafts stop BELOW the open gallery: the previous dark cylinder was
  // buried inside a solid 46 m shaft. References show balustrades/pinnacles, not cones.
  const towerGeo = new THREE.CylinderGeometry(6.2, 7.0, 40, 5);
  const galleryGeo = new THREE.CylinderGeometry(5.6, 5.6, 4, 5);
  const sideCrown = (tower) => {
    const gallery = new THREE.Mesh(galleryGeo, openMat);
    gallery.name = 'CibelesTowerGallery';
    gallery.position.y = 42;
    tower.add(gallery);
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 4, 5), trimMat);
      col.position.set(Math.sin(a) * 6.1, 42, Math.cos(a) * 6.1);
      tower.add(col);
      const pinnacle = new THREE.Mesh(new THREE.ConeGeometry(0.65, 4, 5), trimMat);
      pinnacle.position.set(Math.sin(a) * 6.1, 47, Math.cos(a) * 6.1);
      tower.add(pinnacle);
    }
    for (const [y, h] of [[40, 0.8], [44.5, 1]]) {
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.6, h, 5), trimMat);
      rim.position.y = y;
      tower.add(rim);
    }
  };
  for (const x of [-frontLength / 2, frontLength / 2]) {
    const tower = new THREE.Group();
    tower.name = x < 0 ? 'CibelesNorthTower' : 'CibelesSouthTower';
    tower.position.x = x;
    const shaft = new THREE.Mesh(towerGeo, mat);
    shaft.name = 'CibelesTowerShaft';
    shaft.position.y = 20;
    shaft.castShadow = true;
    tower.add(shaft);
    // Tall narrow recesses distinguish the shaft from a blank defensive turret.
    for (let i = 0; i < 5; i++) {
      const a = (i + 0.5) * Math.PI * 2 / 5;
      // Polygon apothem, plus a small surface offset, puts windows on the flat faces.
      for (const y of [8, 17, 26, 35]) {
        const radius = (7 - 0.8 * y / 40) * Math.cos(Math.PI / 5) + 0.12;
        const opening = new THREE.Mesh(new THREE.BoxGeometry(1.4, 4.8, 0.2), openMat);
        opening.position.set(Math.sin(a) * radius, y, Math.cos(a) * radius);
        opening.rotation.y = a;
        tower.add(opening);
      }
    }
    sideCrown(tower);
    frontage.add(tower);
  }

  // --- Octagonal clock cimborrio over the crossing: drum, open colonnade,
  // clock stage and pinnacled crown. The documented total height is 70 m.
  const clockTower = new THREE.Group();
  clockTower.name = 'CibelesClockTower';
  // Above the central entrance, set behind its facade plane. Position is illustrative.
  clockTower.position.set(frontX - nx * 8, 0, frontZ - nz * 8);
  clockTower.rotation.y = frontage.rotation.y; // principal dial faces the NW entrance
  g.add(clockTower);
  const cimbX = 0, cimbZ = 0;
  // The NW tower anchor is outside the recessed upper tier. Start at the main
  // body roof (28 m), so the cimborrio remains attached rather than floating at 38 m.
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(9, 10, 44, 8), mat);
  drum.name = 'CibelesClockLowerDrum';
  drum.position.set(cimbX, 22, cimbZ);
  drum.castShadow = true;
  clockTower.add(drum);
  // The official frontal photograph places the clock BELOW the tall upper gallery.
  const clockStage = new THREE.Mesh(new THREE.CylinderGeometry(8.6, 8.6, 6, 8), mat);
  clockStage.name = 'CibelesClockStage';
  clockStage.position.set(cimbX, 47, cimbZ);
  clockStage.rotation.y = -Math.PI / 8; // flat octagon faces align with the four dials
  clockStage.castShadow = true;
  clockTower.add(clockStage);
  const galleryCore = new THREE.Mesh(new THREE.CylinderGeometry(7.4, 7.4, 10, 8), openMat);
  galleryCore.name = 'CibelesClockUpperGallery';
  galleryCore.position.y = 55;
  clockTower.add(galleryCore);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + Math.PI / 8;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 10, 6), trimMat);
    col.name = 'CibelesClockGalleryColumn';
    col.position.set(cimbX + Math.sin(a) * 8.2, 55, cimbZ + Math.cos(a) * 8.2);
    clockTower.add(col);
  }
  const clockGeo = new THREE.CylinderGeometry(1.8, 1.8, 0.3, 16);
  const clockRadius = 8.6 * Math.cos(Math.PI / 8) + 0.16;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const face = new THREE.Mesh(clockGeo, trimMat);
    face.name = 'CibelesClockFace';
    // Three.js Euler XYZ transforms the cylinder's +Y axis into (sin(a),0,cos(a)):
    // local Z rotation is applied before X. The dials need the same orientation.
    face.rotation.x = Math.PI / 2;
    face.rotation.z = -a;
    face.position.set(cimbX + Math.sin(a) * clockRadius, 47, cimbZ + Math.cos(a) * clockRadius);
    clockTower.add(face);
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.34, 8), openMat);
    dial.name = 'CibelesClockDial';
    dial.rotation.x = Math.PI / 2;
    dial.rotation.z = -a;
    dial.position.set(cimbX + Math.sin(a) * (clockRadius + 0.04), 47, cimbZ + Math.cos(a) * (clockRadius + 0.04));
    clockTower.add(dial);
    for(const [length,angle] of [[1.25,-0.7],[0.9,0.8]]) {
      const hand=new THREE.Mesh(new THREE.BoxGeometry(0.09,length,0.05),openMat);
      hand.position.set(Math.sin(a)*(clockRadius+0.20),47,Math.cos(a)*(clockRadius+0.20));
      hand.rotation.y=a;hand.rotation.z=angle;clockTower.add(hand);
    }
  }
  const galleryCornice = new THREE.Mesh(new THREE.CylinderGeometry(8.8, 8.8, 0.8, 8), trimMat);
  galleryCornice.name = 'CibelesClockGalleryCornice';
  galleryCornice.position.y = 60.4;
  clockTower.add(galleryCornice);
  const smallDrum = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 6.5, 3, 8), mat);
  smallDrum.position.set(cimbX, 60.5 + 1.5, cimbZ);
  clockTower.add(smallDrum);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 1.5, 8), trimMat);
  crown.position.y = 64.25;
  clockTower.add(crown);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI * 2 / 8;
    const finial = new THREE.Mesh(new THREE.ConeGeometry(0.6, 5, 6), trimMat);
    finial.name = 'CibelesClockPinnacle';
    finial.position.set(Math.sin(a) * 5.8, 67.5, Math.cos(a) * 5.8);
    finial.castShadow = true;
    clockTower.add(finial);
  }

  // --- Roofline pinnacles (white obelisk cones) at the outer corners + south run.
  const pinGeo = new THREE.ConeGeometry(1.4, 5, 6);
  for (const [px, pz] of [[58, 64], [57, -64], [20, -57], [-46.5, 2.5]]) {
    const pin = new THREE.Mesh(pinGeo, trimMat);
    pin.position.set(px, 28 + 2.5, pz);
    g.add(pin);
  }

  // --- Existing rear portico approximation. Its surveyed position remains unresolved;
  // do not identify this east-facing model detail as the west-side Paseo del Prado portico.
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

// Circular basins from the municipal inventory (32.4m,24m,21m diameter).
// Sculpture is a low-poly symbol: two lions, four-wheel chariot and seated goddess.
function buildFuenteDeCibeles(mat, lm) {
  const group=new THREE.Group(); group.name='FuenteCibeles';
  const stone=new THREE.MeshStandardNodeMaterial({color:0xc5bdab,roughness:1});
  const marble=new THREE.MeshStandardNodeMaterial({color:0xe5ded0,roughness:1});
  const water=new THREE.MeshStandardNodeMaterial({color:0x6e999d,roughness:1,metalness:0});
  const add=(geometry,material,x,y,z,parent=group)=>{
    const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);
    mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  for(const [radius,y] of [[16.2,0.25],[12,0.85],[10.5,1.45]]) {
    const rim=new THREE.Shape();rim.absarc(0,0,radius,0,Math.PI*2,false);
    const hole=new THREE.Path();hole.absarc(0,0,radius-0.35,0,Math.PI*2,true);rim.holes.push(hole);
    const ring=add(new THREE.ExtrudeGeometry(rim,{depth:0.35,bevelEnabled:false,curveSegments:24}).rotateX(-Math.PI/2),stone,0,y,0);
    ring.name='CibelesBasinRim';
    const disk=new THREE.CircleGeometry(radius-0.35,48).rotateX(-Math.PI/2);
    add(disk,water,0,y+0.22,0);
  }
  const sculpture=new THREE.Group();sculpture.name='CibelesChariotAndLions';
  // Municipal account: the goddess faces Puerta del Sol.
  sculpture.rotation.y=Math.atan2(-lm.cx,-lm.cz);group.add(sculpture);
  const box=(w,h,d,x,y,z)=>add(new THREE.BoxGeometry(w,h,d),marble,x,y,z,sculpture);
  box(4.7,0.6,12.5,0,2.1,0);
  box(3.4,1.3,4.2,0,3,-2.6);
  for(const x of [-1.9,1.9]) for(const z of [-4,-0.9]) {
    const wheel=add(new THREE.CylinderGeometry(z< -2?1.1:0.85,z< -2?1.1:0.85,0.28,12),stone,x,2.8,z,sculpture);
    wheel.rotation.z=Math.PI/2;
  }
  box(1.8,2.3,0.5,0,4.5,-4); // throne
  const figure=new THREE.Group();figure.name='CibelesSeatedGoddess';sculpture.add(figure);
  add(new THREE.ConeGeometry(0.85,2.5,8),marble,0,4.4,-2.8,figure);
  add(new THREE.CylinderGeometry(0.58,0.75,1.1,8),marble,0,5.45,-2.8,figure);
  add(new THREE.IcosahedronGeometry(0.46,1),marble,0,6.45,-2.8,figure);
  add(new THREE.CylinderGeometry(0.5,0.5,0.35,8),stone,0,6.95,-2.8,figure);
  for(const x of [-1.45,1.45]) {
    const lion=new THREE.Group();lion.name='CibelesLion';lion.position.x=x;sculpture.add(lion);
    const body=add(new THREE.IcosahedronGeometry(1,1),marble,0,3.1,2.9,lion);body.scale.set(0.7,0.75,1.65);
    add(new THREE.IcosahedronGeometry(0.8,1),stone,0,3.75,4.2,lion);
    add(new THREE.IcosahedronGeometry(0.55,1),marble,0,3.8,4.65,lion);
    for(const lx of [-0.4,0.4]) for(const z of [1.8,3.8]) add(new THREE.CylinderGeometry(0.18,0.23,1.1,6),marble,lx,2.55,z,lion);
  }
  for(const x of [-6,6]) add(new THREE.ConeGeometry(0.24,6.4,8),water,x,4.8,0);
  return group;
}

const PROCEDURAL = {
  'Fuente de Cibeles': buildFuenteDeCibeles,
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
    // Solid building: full footprint bbox, up to the documented 70 m cimborrio crown.
    return [{ minX: lm.cx - lm.w / 2, maxX: lm.cx + lm.w / 2, minZ: lm.cz - lm.d / 2, maxZ: lm.cz + lm.d / 2, maxY: 70 }];
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
