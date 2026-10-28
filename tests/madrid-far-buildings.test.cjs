const test = require('node:test');
const assert = require('node:assert/strict');

test('merged far strips remove internal walls and keep the central patio open', async () => {
  const { buildFarBuildings } = await import('../js/madrid-far-buildings.js');
  const corners = (a,b,c,d) => [[a,b],[c,b],[c,d],[a,d]];
  const p = { index: 0, x0: 0, z0: 0, x1: 30, z1: 30, w: 30, d: 30, h: 12, holes: [[10,10,20,10,20,20,10,20]],
    fp: { frame: { ux: 1, uz: 0, vx: 0, vz: 1 }, rects: [
      [0,0,30,10], [0,20,30,30], [0,10,10,20], [20,10,30,20]
    ].map(r => ({ corners: corners(...r) })) } };
  const far = buildFarBuildings([p], [[8,0,0,0]]);
  assert.ok(far.triangles < far.nearTriangles);
  assert.equal(far.representedParcels, 1);
  let capArea = 0, wallArea = 0;
  for (let i = 0; i < far.indices.length; i += 3) {
    const v = Array.from(far.indices.slice(i, i+3)).flatMap(j => Array.from(far.positions.slice(j*3, j*3+3)));
    const ab = [v[3]-v[0],v[4]-v[1],v[5]-v[2]], ac = [v[6]-v[0],v[7]-v[1],v[8]-v[2]];
    const cross = [ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
    const area = Math.hypot(...cross)/2;
    const normal = far.normals.slice(far.indices[i]*3, far.indices[i]*3+3);
    assert.ok(cross.reduce((sum,x,k)=>sum+x*normal[k],0) > 0, 'outward face winding');
    if (normal[1] === 1) {
      capArea += area;
      const x = (v[0]+v[3]+v[6])/3, z = (v[2]+v[5]+v[8])/3;
      assert.ok(!(x>10 && x<20 && z>10 && z<20), 'no cap triangle covers the patio');
    } else wallArea += area;
  }
  assert.equal(capArea, 800);
  assert.equal(wallArea, (120+40)*12, 'only exterior and well walls remain');
});

test('hybrid wells stay detailed and stacked facade tiers become one volume', async () => {
  const { buildFarBuildings } = await import('../js/madrid-far-buildings.js');
  const p = { index: 0, x0: 0, z0: 0, x1: 20, z1: 20, w: 20, d: 20, h: 20 };
  assert.equal(buildFarBuildings([{...p, holes: [[5,5,10,5,10,10,5,10]]}], [[0,0,0,0]]).representedParcels, 0);
  const far = buildFarBuildings([p], [[15,0,0,0]]);
  assert.equal(far.nearTriangles, 24);
  assert.equal(far.triangles, 10);
});
