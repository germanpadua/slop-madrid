const test=require('node:test');const assert=require('node:assert/strict');
test('municipal inventory decodes unique source IDs, valid heights and owned tile positions',async()=>{
 const {municipalParkTreePoints}=await import('../js/madrid-municipal-tree-points.js');
 const {MUNICIPAL_PARK_TREES}=await import('../js/madrid-municipal-tree-data.js');
 const ids=new Set();let count=0;
 for(const [id,points]of municipalParkTreePoints){
  assert.equal(points.length,MUNICIPAL_PARK_TREES[id].count);
  for(const p of points){
   assert.ok(!ids.has(p.id),'one canonical municipal record per coordinate');ids.add(p.id);count++;
   assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.z));
   assert.ok(!p.tags.height||(Number(p.tags.height)>0&&Number(p.tags.height)<60));
   assert.ok(p.crownGlyphDiameter>=1&&p.crownGlyphDiameter<=10);
  }
 }
 assert.equal(count,21000);
});
