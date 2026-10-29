import fs from 'node:fs';
import { GEO } from '../../js/madrid-geodata.js';
import { toWorld, SOLX, SOLY } from './projection.mjs';
const manifest=JSON.parse(fs.readFileSync(new URL('./tiles.json',import.meta.url)));
const tiles=[];
for(const t of manifest.tiles.filter(t=>t.status==='ready')) {
 const data=t.id==='fase2'?GEO:(await import(new URL(`../../js/geodata/tile-${t.id}.js`,import.meta.url))).TILE;
 const parks=(data.parks||[]).filter(p=>/Retiro/i.test(p.name));
 if(parks.length) tiles.push({id:t.id,core:t.core,parks,water:data.water||[]});
}
const source=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const ways=source.roads.filter(w=>['footway','path','pedestrian'].includes(w.tags.highway)&&w.tags.access!=='private'&&w.tags.access!=='no')
 .map(w=>({id:w.id,tags:w.tags,points:w.nodes.map(([,lon,lat])=>toWorld(lon,lat))}));
fs.writeFileSync(process.argv[3],JSON.stringify({source:source.source,originUTM:[SOLX,SOLY],tiles,ways}));console.log(tiles.map(t=>[t.id,t.parks.length]));
