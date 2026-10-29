const test = require('node:test');
const assert = require('node:assert/strict');
test('marked source crossings match physical roads once and do not invent junction crossings', async () => {
 const { matchMarkedCrossings } = await import('../js/madrid-crosswalk-matching.js');
 const e = { x0:0,z0:0,sx:10,sz:0,dx:1,dz:0,span:100,half:5 };
 assert.equal(matchMarkedCrossings([e], []).length,0);
 const hits = matchMarkedCrossings([e,e], [[1,20,0],[1,20,0],[2,30,20],[3,150,0]]);
 assert.equal(hits.length,1);
 assert.equal(hits[0].s,10);
 assert.equal(hits[0].id,1);
});
