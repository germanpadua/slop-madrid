import { MUNICIPAL_PARK_TREES } from './madrid-municipal-tree-data.js';
export const municipalParkTreePoints=new Map();
export function insideMunicipalPark(id,x,z) {
  const data=MUNICIPAL_PARK_TREES[id];if(!data)return false;
  for(const r of data.rings){
    let inside=false;
    for(let i=0,j=r.length-2;i<r.length;j=i,i+=2){
      if((r[i+1]>z)!==(r[j+1]>z)&&x<(r[j]-r[i])*(z-r[i+1])/(r[j+1]-r[i+1])+r[i])inside=!inside;
    }
    if(inside)return true;
  }
  return false;
}
for(const [id,data] of Object.entries(MUNICIPAL_PARK_TREES)) {
  const packed=Uint8Array.from(atob(data.data),c=>c.charCodeAt(0));
  const buffer=await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
  const bytes=new Uint8Array(buffer),view=new DataView(buffer);let at=0,oid=0;const points=[];
  for(let i=0;i<data.count;i++){
    let delta=0,shift=0,b;
    do {b=bytes[at++];delta|=(b&127)<<shift;shift+=7;}while(b&128);
    oid+=delta;
    const x=data.origin[0]+view.getUint16(at,true)/10,z=data.origin[1]+view.getUint16(at+2,true)/10,h=bytes[at+4]/4;at+=5;
    points.push({id:oid,x,z,tags:h>0?{height:String(h)}:{},crownGlyphDiameter:Math.min(10,Math.max(1,(h||7)*0.45))});
  }
  if(at!==bytes.length)throw new Error(`Municipal tree payload length mismatch: ${id}`);
  municipalParkTreePoints.set(id,points);
}
