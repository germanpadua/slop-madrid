import { utmForward } from '/home/sandbox/slop-madrid/tools/madrid/projection.mjs';
import fs from 'node:fs';
const BASE="https://tiles-eu1.arcgis.com/UrtTdLP2PYSxwtI6/arcgis/rest/services/MODELADO_3D_MADRID/SceneServer/layers/0";
const [sx,sy]=utmForward(-3.7037900,40.4167750);
const w=(lon,lat)=>{const [x,y]=utmForward(lon,lat);return [x-sx,-(y-sy)];};
const R={x0:1540,x1:1760,z0:-1670,z1:-1560};
const inR=(x,z)=>x>=R.x0&&x<=R.x1&&z>=R.z0&&z<=R.z1;
const idx=JSON.parse(fs.readFileSync('/tmp/i3s-test/index.json'));
const out=[];let all=0,wallAll=0,fail=0;
for(const l of idx.leaves){
  const nj=await (await fetch(`${BASE}/nodes/${l.node}?f=json`)).json();
  const [cx,cy,cz]=nj.mbs;const b=fs.readFileSync(`/tmp/i3s-test/${l.node}.bin`);
  const vc=b.readUInt32LE(0); if(vc!==l.vertices){fail++;continue;}
  const P=[];for(let i=0;i<vc;i++){const o=8+i*12;const [x,z]=w(cx+b.readFloatLE(o),cy+b.readFloatLE(o+4));P.push([x,z,cz+b.readFloatLE(o+8)]);}
  for(let t=0;t+2<vc;t+=3){
    const a=P[t],c=P[t+1],d=P[t+2];
    const u=[c[0]-a[0],c[1]-a[1],c[2]-a[2]],v=[d[0]-a[0],d[1]-a[1],d[2]-a[2]];
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];const m=Math.hypot(...n)||1;
    const wall=Math.abs(n[2]/m)<0.3; // world z (south) is index1; vertical axis is index2 (height)
    // vertical axis is height = index 2 of P; face normal vertical component = n[2]?? P=[x,z,h]; cross uses same ordering so n[2] is normal along h only if axes right-handed: yes component 2 = along h
    all++;if(wall)wallAll++;
    const cxw=(a[0]+c[0]+d[0])/3,czw=(a[1]+c[1]+d[1])/3;
    if(inR(cxw,czw))out.push({t:[a,c,d],wall});
  }
}
console.log('all tris',all,'wall%',(100*wallAll/all).toFixed(1),'decodeFail',fail,'tris in rect',out.length,'wall in rect',out.filter(o=>o.wall).length);
// vertex counts in rect (non-indexed)
console.log('i3s vertices in rect',out.length*3,'est raw bytes @36B/vertex',out.length*3*36);
let hmin=Infinity,hmax=-Infinity;for(const o of out)for(const p of o.t){hmin=Math.min(hmin,p[2]);hmax=Math.max(hmax,p[2]);}
console.log('height range',hmin.toFixed(1),hmax.toFixed(1));
fs.writeFileSync('/tmp/i3s-rect.json',JSON.stringify(out.map(o=>o.t.flat().map(v=>Math.round(v*100)/100).concat(o.wall?1:0))));
// ours
const {TILE}=await import('/home/sandbox/slop-madrid/js/geodata/tile-k3j3.js');
const par=[];let ptris=0,pv=0;
for(const p of TILE.parcels){const r=p.ring;let cx=0,cz=0,n=r.length/2;for(let i=0;i<r.length;i+=2){cx+=r[i];cz+=r[i+1];}cx/=n;cz/=n;
 if(inR(cx,cz)){par.push({ring:r,h:p.h});}}
console.log('our parcels in rect',par.length,'heights sample',par.slice(0,5).map(p=>p.h));
let est=0;for(const p of par){const n=p.ring.length/2;est+= (n-2)+ n*2;} // roof fan + 2 tris per wall
console.log('our extrusion tri estimate (flat roof, no hip roofs/facade detail)',est);
fs.writeFileSync('/tmp/our-rect.json',JSON.stringify(par));
