const test = require('node:test');
const assert = require('node:assert/strict');
const way = (id, nodes, tags={}) => ({id,nodes,tags:{highway:'residential',name:'Calle real',...tags}});
const features = ways => ({ways,signals:[]});

test('resident graph joins source IDs across cells, collapses shape nodes and removes unloaded edges',async()=>{
 const {buildResidentRoadGraph}=await import('../js/madrid-resident-road-graph.js');
 const left=features([way(10,[[1,0,0],[2,10,0],[3,20,0]])]);
 const right=features([way(10,[[3,20,0],[4,30,0]])]);
 const graph=buildResidentRoadGraph([left,right]);
 assert.equal(graph.links.length,1);
 assert.deepEqual(buildResidentRoadGraph([right,left]),graph, 'loading order does not alter source topology');
 assert.deepEqual(graph.nodes,[0,0,30,0]);
 assert.deepEqual(graph.links[0][6],[10,0,20,0]);
 const dropped=buildResidentRoadGraph([left]);
 assert.deepEqual(dropped.nodes,[0,0,20,0]);
 assert.ok(!dropped.osmNodeIds.includes(4));
});

test('crossing or coincident geometry never invents a shared OSM junction',async()=>{
 const {buildResidentRoadGraph}=await import('../js/madrid-resident-road-graph.js');
 const graph=buildResidentRoadGraph([features([
  way(10,[[1,-10,0],[2,0,0],[3,10,0]]),
  way(20,[[4,0,-10],[5,0,0],[6,0,10]])])]);
 assert.equal(graph.links.length,2);
 assert.equal(graph.osmNodeIds.length,4);
 assert.deepEqual(new Set(graph.osmNodeIds),new Set([1,3,4,6]));
});

test('surface policy respects vehicle access, one-way, roundabouts and surveyed grade tags',async()=>{
 const {surfaceRoadPolicy:p}=await import('../js/madrid-resident-road-graph.js');
 for(const tags of [{highway:'pedestrian'},{highway:'footway'},{highway:'residential',motor_vehicle:'no'},
  {highway:'service',access:'private'},{highway:'primary',bridge:'yes'},{highway:'primary',tunnel:'yes'},
  {highway:'secondary',layer:'-1'}]) assert.equal(p(tags),null);
 assert.equal(p({highway:'residential',oneway:'-1'}).dir,-1);
 assert.equal(p({highway:'residential',junction:'roundabout'}).dir,1);
 assert.equal(p({highway:'residential',junction:'roundabout',oneway:'no'}).dir,0);
 assert.equal(p({highway:'service',access:'private',motor_vehicle:'yes',width:'6,5 m'}).width,6.5);
});

test('real junctions and traffic-signal source nodes survive simplification',async()=>{
 const {buildResidentRoadGraph}=await import('../js/madrid-resident-road-graph.js');
 const data={ways:[way(1,[[10,0,0],[11,10,0],[12,20,0]]),way(2,[[11,10,0],[13,10,10]])],signals:[{id:12,x:20,z:0}]};
 const graph=buildResidentRoadGraph([data]);
 assert.equal(graph.links.length,3);
 assert.ok(graph.osmNodeIds.includes(11));
 assert.deepEqual(graph.signals,data.signals);
 assert.throws(()=>buildResidentRoadGraph([data,features([way(3,[[11,999,0],[15,1000,0]])])]),/conflicting coordinates/);
});

test('closed source ways retain real anchors instead of becoming discarded self-links',async()=>{
 const {buildResidentRoadGraph}=await import('../js/madrid-resident-road-graph.js');
 const graph=buildResidentRoadGraph([features([way(8,[[1,0,0],[2,200,0],[3,200,200],[4,0,200],[1,0,0]],{junction:'roundabout'})])]);
 assert.equal(graph.links.length,2);
 assert.ok(graph.links.every(l=>l[0]!==l[1]&&l[5]===1));
 assert.deepEqual(graph.osmNodeIds,[1,3]);
 assert.deepEqual(graph.links.map(l=>l[6]),[[200,0],[0,200]]);
});

test('lane preparation outside the seed uses only resident source roads and coverage',async()=>{
 const {buildResidentRoadGraph}=await import('../js/madrid-resident-road-graph.js');
 const {buildRoadNetwork}=await import('../js/road-network.js');
 const graph=buildResidentRoadGraph([features([
  way(1,[[1,3000,0],[2,3200,0]]),way(2,[[2,3200,0],[3,3200,200]]),
  way(3,[[3,3200,200],[4,3000,200]]),way(4,[[4,3000,200],[1,3000,0]])])]);
 const network=buildRoadNetwork([],[],[],{roadGraph:graph,coverage:[[2980,-20,3220,220]],sourceOnly:true});
 assert.ok(network.edges.length>=4,'surface roads can carry traffic beyond seed bounds');
 assert.ok(network.nodes.every(n=>n.x>=3000&&n.x<=3200&&n.z>=0&&n.z<=200),'no inherited grid junctions inserted');
 assert.equal(network.walkable(4000,4001,0,1),false,'unloaded terrain is not walkable');
 assert.equal(network.walkable(3050,3051,50,51),true);
});
