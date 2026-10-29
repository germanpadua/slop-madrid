const test=require('node:test');
const assert=require('node:assert/strict');
let roadSurfacePositions;
test.before(async()=>({roadSurfacePositions}=await import('../js/madrid-road-surface-geometry.js')));
const road=points=>['street',8,0,2,0,points];
test('carriageways follow the source width, have upward winding and own only their tile core',()=>{
  const positions=roadSurfacePositions([road([-20,0,20,0])],[[-10,-10,10,10]]);
  assert.ok(positions.length>0);
  for(let i=0;i<positions.length;i+=3) {
    assert.ok(positions[i]>=-10&&positions[i]<=10);
    assert.ok(Math.abs(positions[i+2])<=4);
    assert.ok(Math.abs(positions[i+1]-.015)<1e-8);
  }
  for(let i=0;i<positions.length;i+=9) {
    const [ax,,az,bx,,bz,cx,,cz]=positions.slice(i,i+9);
    assert.ok((bz-az)*(cx-ax)-(bx-ax)*(cz-az)>0,'upward triangle');
  }
});
test('sharp and repeated nodes remain finite without long mitres or geometry outside the core',()=>{
  const p=roadSurfacePositions([road([0,0,0,0,10,0,1,1])],[[-5,-5,15,10]]);
  assert.ok(p.length>0);
  for(let i=0;i<p.length;i+=3) {
    assert.ok(Number.isFinite(p[i])&&Number.isFinite(p[i+2]));
    assert.ok(p[i]>=-4&&p[i]<=14);
    assert.ok(p[i+2]>=-4&&p[i+2]<=5);
  }
});
test('invalid widths and roads entirely outside a core do not draw',()=>{
  assert.equal(roadSurfacePositions([['',0,0,0,0,[0,0,10,10]],road([100,100,110,110])],[[-5,-5,5,5]]).length,0);
});
test('source corridors exclude tunnels and match the painted surface query',async()=>{
  const {surfaceRoads,createRoadSurfaceQuery}=await import('../js/madrid-road-surface-geometry.js');
  const ways=[
    {tags:{highway:'residential',width:'8'},nodes:[[1,-20,0],[2,20,0]]},
    {tags:{highway:'primary',tunnel:'yes'},nodes:[[3,0,-20],[4,0,20]]},
    {tags:{highway:'footway'},nodes:[[5,10,-20],[6,10,20]]}
  ];
  const roads=surfaceRoads({ways});assert.equal(roads.length,1);
  const contains=createRoadSurfaceQuery(roads);
  assert.equal(contains(0,3.9),true);
  assert.equal(contains(0,4.1),false,'crossing approaches beyond the carriageway are not painted');
  assert.equal(contains(0,15),false,'underground source way is not an asphalt surface');
  assert.equal(contains(10,15),false,'footway is not a carriageway');
  assert.equal(contains(23,0),true,'round end join');
  assert.equal(contains(25,0),false);
});
