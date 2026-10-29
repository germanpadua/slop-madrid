import fs from 'node:fs';
import { GEO } from '../../js/madrid-geodata.js';
import { toWorld } from './projection.mjs';
const topology=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const nodes=new Map(topology.ways.flatMap(w=>w.nodes.map(([id,lon,lat])=>[id,toWorld(lon,lat)])));
const outlines=Object.fromEntries(Object.entries(topology.buildings).map(([name,b])=>[name,b.rings.map(r=>({role:r.role,ways:r.ways,ring:r.nodeIds.slice(0,-1).flatMap(id=>nodes.get(id))}))]));
const buildingLevels=Object.fromEntries(Object.entries(topology.buildings).map(([name,b])=>{
 const tags=b.relation?topology.relations.find(r=>r.id===b.relation)?.tags:topology.ways.find(w=>w.id===b.outer)?.tags;
 return [name,Number(tags?.['building:levels'])||0];
}));
fs.writeFileSync(process.argv[3],JSON.stringify({seed:GEO,source:topology.source,outlines,buildingLevels,ways:topology.ways.map(w=>({...w,ring:w.nodes.flatMap(([,lon,lat])=>toWorld(lon,lat))}))}));
