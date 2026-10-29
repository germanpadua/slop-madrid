const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
test('pending-coverage floor stays below mounted decks and water',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../js/madrid-tile-world.js'),'utf8');
 const fn=source.match(/function createOutOfMapFloor\([^]*?\n\}/)[0];
 class Plane{rotateX(){return this;}}
 class Material{constructor(){this.color={setHex(){}};}}
 class Mesh{constructor(){this.position={set(x,y,z){Object.assign(this,{x,y,z});}};}}
 const create=vm.runInNewContext(`(${fn})`,{THREE:{PlaneGeometry:Plane,MeshStandardNodeMaterial:Material,Mesh}});
 const floor=create({add(){}},[0,0,100,100]);
 assert.ok(floor.position.y < -0.6,'backdrop cannot occlude the -0.45m water surface or the -0.6m slab');
});

test('seed deck core matches the manifest and does not overlap neighboring ready tile interiors',async()=>{
 const {GEO}=await import('../js/madrid-geodata.js');
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../tools/madrid/tiles.json'),'utf8'));
 const seed=manifest.tiles.find(t=>t.id==='fase2');assert.deepEqual(GEO.core,seed.core);
 for(const tile of manifest.tiles.filter(t=>t.status==='ready'&&t.id!=='fase2'))for(const a of GEO.core)for(const b of tile.core){
  const width=Math.min(a[2],b[2])-Math.max(a[0],b[0]);
  const depth=Math.min(a[3],b[3])-Math.max(a[1],b[1]);
  assert.ok(width<=1e-6||depth<=1e-6,`coplanar ground overlap with ${tile.id}`);
 }
});
