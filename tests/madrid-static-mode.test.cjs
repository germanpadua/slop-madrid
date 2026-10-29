const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../js/traffic.js'),'utf8');
const fn=name=>source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0];
test('disabled ambient systems construct no actors and still accept resident networks',()=>{
 let builds=0;const seed={nodes:[],edges:[]};
 const create=vm.runInNewContext(`(${fn('createTrafficSystem')})`,{THREE:{Group:class{}},buildRoadNetwork:()=>{builds++;return seed;}});
 const system=create(null,[],[],[],{enabled:false});
 assert.equal(builds,1);assert.equal(system.getNetwork(),seed);
 assert.equal(system.cars.length+system.peds.length+system.buses.length,0);
 const resident={nodes:[1],edges:[1]};system.setNetwork(resident);assert.equal(system.getNetwork(),resident);system.update();
 const highway=vm.runInNewContext(`(${fn('createHighwayTraffic')})`,{THREE:{Group:class{}}});
 assert.equal(highway(null,[],{enabled:false}).cars.length,0);
});

test('Madrid street details do not construct NYC furniture or procedural planting',()=>{
 const text=fs.readFileSync(path.join(__dirname,'../js/street-details.js'),'utf8');
 const fn=text.match(/function buildStreetDetails\([^]*?\n\}/)[0];
 const build=vm.runInNewContext(`(${fn})`,{GEO:{frame:{madrid:true}},THREE:{Group:class{}},uniform:value=>({value})});
 const groups=[];const details=build({add:g=>groups.push(g)});
 assert.equal(groups.length,1);assert.equal(details.group.name,'MadridStreetDetails');
 assert.equal(details.footprints.length,0);assert.equal(details.audioSignals.length,0);
 details.signalClock.value=20;details.update();
});
