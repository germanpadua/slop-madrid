import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT='/home/sandbox/slop-madrid';
const { chromium } = await import('/tmp/pw/node_modules/playwright-core/index.mjs');
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json'};
const server=http.createServer((req,res)=>{const url=decodeURIComponent(req.url.split('?')[0]);const file=path.join(ROOT,url==='/'?'/tile-mapcheck.html':url);
 if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404).end();return;}
 res.writeHead(200,{'content-type':MIME[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(file).pipe(res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=swiftshader','--enable-webgpu-developer-features']});
const page=await browser.newPage({viewport:{width:960,height:540}});
page.on('pageerror',e=>console.log('ERR:',String(e).slice(0,300)));
await page.goto(`http://127.0.0.1:${port}/?tile=k3j3&env=1`,{waitUntil:'load',timeout:90000});
await page.waitForFunction(()=>window.__mc&&window.__mc.ready,null,{timeout:90000,polling:400});
const out=await page.evaluate(async()=>{
 const {scene,THREE,renderer}=window.__mc;
try{ const lod=await (await fetch('./.cand/lod2-rect.json')).json();
 const ground=Math.min(...lod.map(t=>Math.min(t[2],t[5],t[8])));
 const R={x0:1540,x1:1760,z0:-1670,z1:-1560};
 const cam=new THREE.PerspectiveCamera(38,960/540,1,2000);cam.position.set(1565,105,-1465);cam.lookAt(1650,12,-1615);cam.updateMatrixWorld();
 const shots={};const grab=async(name)=>{renderer.render(scene,cam);await new Promise(r=>setTimeout(r,300));renderer.render(scene,cam);shots[name]=renderer.domElement.toDataURL('image/png');};
 const bnames=/^(TileBuildings|TileHipRoofs|TileHybrid|TileMedianera|TileMergedZone|TileFarBuildings)/;
 // clip current tile to the rect via scissor-like approach: hide nothing, just frame the rect
 const tiles=window.__mc.tiles.map(t=>t.group);
 // (A) current
 await grab('A_current');
 // candidate geometry
 const welded=(tris,skipWalls)=>{const vm=new Map(),P=[],I=[];for(const t of tris){if(skipWalls&&t[9])continue;for(let k=0;k<3;k++){const x=t[k*3],z=t[k*3+1],h=t[k*3+2]-ground;const key=Math.round(x*10)+','+Math.round(z*10)+','+Math.round(h*10);let i=vm.get(key);if(i===undefined){i=P.length/3;vm.set(key,i);P.push(x,h,z);}I.push(i);}}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setIndex(I);g.computeVertexNormals();return g;};
 const mk=(g,tag)=>{const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0xc9c2b4,roughness:0.9,side:THREE.DoubleSide,flatShading:true}));m.name=tag;scene.add(m);return m;};
 const tri=(g)=>g.index.count/3;
 const hidden=[];for(const grp of tiles)grp.traverse(o=>{if(bnames.test(o.name||'')&&o.visible){o.visible=false;hidden.push(o);}});
 const g1=welded(lod,false);window.__dbg=[typeof g1, g1&&Object.keys(g1).slice(0,8)];let m=mk(g1,'cand-full');const stats={full:tri(g1),fullVerts:g1.attributes.position.count};
 await grab('B_lod2_full');
 scene.remove(m);
 // (C/D) vertex-clustering simplification at 1.0 m and 2.0 m grids (weld, drop degenerates)
 const cluster=(cell)=>{const vm=new Map(),P=[],I=[];const seen=new Set();for(const t of lod){const ids=[];for(let k=0;k<3;k++){const x=t[k*3],z=t[k*3+1],h=t[k*3+2]-ground;const key=Math.round(x/cell)+','+Math.round(z/cell)+','+Math.round(h/cell);let i=vm.get(key);if(i===undefined){i=P.length/3;vm.set(key,[0]);vm.set(key,i);P.push(Math.round(x/cell)*cell,Math.round(h/cell)*cell,Math.round(z/cell)*cell);}ids.push(i);}
   if(ids[0]===ids[1]||ids[1]===ids[2]||ids[0]===ids[2])continue;const sk=ids.slice().sort((p,q)=>p-q).join('_');if(seen.has(sk))continue;seen.add(sk);I.push(...ids);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setIndex(I);g.computeVertexNormals();return g;};
 for(const cell of [1,2]){const g=cluster(cell);stats['cluster'+cell+'m']={tris:g.index.count/3,verts:g.attributes.position.count};m=mk(g,'cand-c'+cell);await grab('C_cluster_'+cell+'m');scene.remove(m);}
 for(const o of hidden)o.visible=true;
return {shots,stats};}catch(e){return {err:String(e.stack).slice(0,600)+JSON.stringify(window.__dbg),shots:{},stats:{}};}
});
if(out.err)console.log(out.err);
for(const [k,v] of Object.entries(out.shots))fs.writeFileSync(`/downloads/cand-${k}.png`,Buffer.from(v.split(',')[1],'base64'));
console.log(JSON.stringify(out.stats));
await browser.close();server.close();
