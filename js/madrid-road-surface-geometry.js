import { surfaceRoadPolicy } from './madrid-resident-road-graph.js';
// Source centreline corridors. Widths inherit the geodata builder's estimates;
// they describe an illustrated carriageway, not surveyed kerb boundaries.
function clip(poly, axis, edge, sign) {
  const out=[];
  for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const a=poly[j],b=poly[i],da=sign*(a[axis]-edge),db=sign*(b[axis]-edge);
    if((da>=0)!==(db>=0)) {
      const t=da/(da-db);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);
    }
    if(db>=0)out.push(b);
  }
  return out;
}
export function roadSurfacePositions(roads, cores, y=0.015) {
  const vertices=[];
  const add=(poly)=>{
    for(const [x0,z0,x1,z1] of cores) {
      let p=clip(poly,0,x0,1);p=clip(p,0,x1,-1);p=clip(p,1,z0,1);p=clip(p,1,z1,-1);
      for(let i=1;i+1<p.length;i++) {
        const a=p[0],b=p[i],c=p[i+1];
        const area=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
        if(Math.abs(area)<1e-6)continue;
        for(const v of area<0?[a,b,c]:[a,c,b])vertices.push(v[0],y,v[1]);
      }
    }
  };
  for(const road of roads) {
    const w=Number(road[1]),flat=road[5];
    if(!(w>0)||!Array.isArray(flat))continue;
    const r=w/2;
    for(let i=2;i<flat.length;i+=2) {
      const ax=flat[i-2],az=flat[i-1],bx=flat[i],bz=flat[i+1];
      const len=Math.hypot(bx-ax,bz-az);if(len<0.01)continue;
      const nx=-(bz-az)*r/len,nz=(bx-ax)*r/len;
      add([[ax+nx,az+nz],[bx+nx,bz+nz],[bx-nx,bz-nz],[ax-nx,az-nz]]);
    }
    // Same-material round joins avoid cracks at sharp corners without long mitres.
    for(let i=0;i<flat.length;i+=2) {
      add(Array.from({length:12},(_,j)=>{
        const a=j*Math.PI/6;return [flat[i]+Math.cos(a)*r,flat[i+1]+Math.sin(a)*r];
      }));
    }
  }
  return new Float32Array(vertices);
}

export function surfaceRoads(features) {
  return (features?.ways||[]).flatMap(way=>{
    const policy=surfaceRoadPolicy(way.tags||{});
    return policy?[[way.tags?.name||'',policy.width,policy.dir,policy.lanes,0,way.nodes.flatMap(([,x,z])=>[x,z])]]:[];
  });
}

// Spatial lookup for clipping mapped crossing approaches to the carriageway.
export function createRoadSurfaceQuery(roads) {
  const cells=new Map(),size=32;
  for(const road of roads) {
    const r=road[1]/2,p=road[5];
    if(!(r>0))continue;
    for(let i=2;i<p.length;i+=2) {
      const segment={ax:p[i-2],az:p[i-1],bx:p[i],bz:p[i+1],r};
      for(let x=Math.floor((Math.min(segment.ax,segment.bx)-r)/size);x<=Math.floor((Math.max(segment.ax,segment.bx)+r)/size);x++)
        for(let z=Math.floor((Math.min(segment.az,segment.bz)-r)/size);z<=Math.floor((Math.max(segment.az,segment.bz)+r)/size);z++) {
          const key=x+','+z;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(segment);
        }
    }
  }
  return (x,z)=>{
    for(const s of cells.get(Math.floor(x/size)+','+Math.floor(z/size))||[]) {
      const dx=s.bx-s.ax,dz=s.bz-s.az,d=dx*dx+dz*dz;
      const t=d?Math.max(0,Math.min(1,((x-s.ax)*dx+(z-s.az)*dz)/d)):0;
      if(Math.hypot(x-s.ax-t*dx,z-s.az-t*dz)<=s.r)return true;
    }
    return false;
  };
}
