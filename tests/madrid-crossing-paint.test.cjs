const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../js/road-paint.js'),'utf8')
  .replace(/^import .*;\n/gm,'').replace(/export \{[^}]+\};/g,'');
class Geometry {
  attributes={};setAttribute(k,v){this.attributes[k]=v;}setIndex(i){this.index=i;}
}
class Attribute {constructor(array,size){this.array=Array.from(array);this.itemSize=size;}}
class Mesh {constructor(geometry){this.geometry=geometry;this.userData={};}}
const THREE={BufferGeometry:Geometry,BufferAttribute:Attribute,Float32BufferAttribute:Attribute,Mesh,
  Color:class{r=1;g=1;b=1;}};
const edge={from:{id:1},to:{id:2},dx:1,dz:0,len:100,half:4,sx:-50,sz:0,x0:-50,z0:0,span:100,lanes:[0]};
async function paint(contains){
 const {matchMarkedCrossings}=await import('../js/madrid-crosswalk-matching.js');
 const build=vm.runInNewContext(source+';buildPaintMesh',{THREE,CROSSWALK:3,
   MADRID_CROSSING_PATHS:[[1,[[0,-10],[0,10]]]],matchMarkedCrossings});
 return build({paintEdges:[edge]}, {}, contains).geometry.attributes.position.array;
}
test('mapped crossing paint stops at carriageway edges and preserves an unpainted refuge',async()=>{
 const p=await paint((x,z)=>Math.abs(z)<=4&&Math.abs(z)>=1);
 assert.ok(p.length>0);
 for(let i=0;i<p.length;i+=12){
   const z=[p[i+2],p[i+5],p[i+8],p[i+11]];
   assert.ok(z.every(v=>Math.abs(v)<=4.2),'sampling tolerance is less than 0.2m');
   assert.ok(Math.min(...z)>=0.8||Math.max(...z)<=-0.8,'no stripe crosses the refuge');
 }
 assert.equal((await paint(()=>false)).length,0,'no paint when the source crossing is outside the rendered road');
});
