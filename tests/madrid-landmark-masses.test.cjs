const test=require('node:test');const assert=require('node:assert/strict');
test('source massing keeps assembled courtyards and multiple parcel elevations',async()=>{
 const {MADRID_LANDMARK_MASSES:m,MADRID_LANDMARK_SITES:s}=await import('../js/madrid-landmark-masses.js');
 assert.equal(s['Banco de España'].holes.length,6);
 assert.equal(s['Palacio Real'].holes.length,4);
 assert.equal(s['Catedral de la Almudena'].holes.length,2);
 for(const name of ['Banco de España','Palacio de Cibeles','Palacio Real','Teatro Real','Catedral de la Almudena']){
  assert.ok(m[name].parts.length>1,name);
  assert.ok(new Set(m[name].parts.map(p=>p.h)).size>1,`${name} has source height variation`);
  assert.ok(m[name].coverage>0.7&&m[name].coverage<=1,`${name} does not invent fill beyond sourced volumes`);
  for(const p of m[name].parts){assert.ok(p.h>0&&p.h<160);assert.ok(p.ring.length>=6&&p.ring.every(Number.isFinite));}
 }
 assert.ok(m['Banco de España'].parts.some(p=>p.holes.length>0),'inner rings survive as actual extrusion holes');
 assert.ok(m['Palacio Real'].parts.some(p=>p.holes.length>0));
 assert.ok(m['Palacio de Cibeles'].glass.every(p=>p.osmWay&&p.heightSource),'glazed roofs keep source provenance');
});
