// Reproducible real seed-path capture. Usage: node tools/madrid/seed-facades.mjs [--baseline REF] [--webgpu]
// Playwright is external to the app; override PLAYWRIGHT_MODULE if needed.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const pw=await import(process.env.PLAYWRIGHT_MODULE || '/tmp/pw/node_modules/playwright/index.js');
const baseline=process.argv.includes('--baseline') ? process.argv[process.argv.indexOf('--baseline')+1] : null;
const backend=process.argv.includes('--webgpu')?'webgpu':'webgl';
const label=baseline?'before':'after';
const prefix=path.join(root,'tools/madrid/measurements',`${new Date().toISOString().slice(0,10)}-seed-${label}-${backend}`);
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json'};
const server=http.createServer((req,res)=>{
 const pathname=decodeURIComponent(req.url.split('?')[0]);
 const file=path.resolve(root,'.'+pathname);
 if(!file.startsWith(root+'/'))return res.writeHead(403).end();
 try {
  const body=baseline && pathname.startsWith('/js/') ? execFileSync('git',['show',`${baseline}:${pathname.slice(1)}`],{cwd:root,maxBuffer:30*1024*1024}) : fs.readFileSync(file);
  res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'}).end(body);
 }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await (pw.chromium||pw.default.chromium).launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader',...(backend==='webgpu'?['--enable-unsafe-webgpu','--enable-features=Vulkan','--enable-webgpu-developer-features']:[])]});
try {
 const page=await browser.newPage({viewport:{width:1200,height:900}});const errors=[];
 page.on('pageerror',e=>{errors.push(String(e));console.error(String(e));});page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.error(m.text());}});
 await page.addInitScript(() => { window.shaderCounts={compiles:0,links:0}; for(const [method,key] of [['compileShader','compiles'],['linkProgram','links']]) { const original=WebGL2RenderingContext.prototype[method]; WebGL2RenderingContext.prototype[method]=function(...args){window.shaderCounts[key]++;return original.apply(this,args);}; } });
 await page.goto(`http://127.0.0.1:${server.address().port}/tools/madrid/seed-facades.html?capture${backend==='webgpu'?'&webgpu':''}`);
 await page.waitForFunction(()=>window.result,null,{timeout:120000});
 await page.screenshot({path:prefix+'.png'});
 const result=await page.evaluate(()=>window.result);
 const geometrySHA256=createHash('sha256').update(JSON.stringify({colliders:result.colliders,blocks:result.blocks})).digest('hex');
 delete result.colliders;delete result.blocks;
 await page.evaluate(()=>window.captureDetail());await page.screenshot({path:prefix+'-detail.png'});
 await page.evaluate(()=>window.captureNight());await page.screenshot({path:prefix+'-night.png'});
 if(!baseline){
  result.shaderProbe=await page.evaluate(async()=>{
   const {THREE,seed,renderer}=window.probe;
   const {createTileWorld}=await import('/js/madrid-tile-world.js');
   const scene=new THREE.Scene();scene.add(new THREE.AmbientLight(0xffffff,2));
   const {createFacadeBoxes}=await import('/js/tsl-materials.js');
   const seedMeshes=window.probe.FACADE_DEFS.map(([create,opts],i)=>createFacadeBoxes(create(opts),[{x:400+i*10,y:10,z:400,w:8,h:20,d:8}]));
   for(const mesh of seedMeshes)scene.add(mesh);
   const camera=new THREE.PerspectiveCamera(50,1,0.1,10000);camera.position.set(450,200,600);camera.lookAt(450,0,400);
   await renderer.compileAsync(scene,camera);
   const programs=()=>window.shaderCounts.links;
   const before=programs();
   const world=createTileWorld(scene);
   const parcels=Array.from({length:80},(_,i)=>{const x=400+(i%10)*8,z=350+Math.floor(i/10)*8;return {ring:[x,z,x+7,z,x+7,z+7,x,z+7],h:15};});
   world.addTile({id:'shader-probe',core:[[350,300,550,500]],parcels});
   const tiles=[];scene.traverse(o=>{if(o.name.startsWith('TileBuildings'))tiles.push(o);});
   // Compile only facade meshes with identical lighting/render state.
   for(const o of [...scene.children])if(o.isGroup)o.visible=false;
   for(const o of tiles)scene.add(o);
   await renderer.compileAsync(scene,camera);await renderer.renderAsync(scene,camera);
   const after=programs();
   return {seedPalettes:seedMeshes.length,tilePalettes:tiles.length,sharedMaterials:tiles.map(t=>seedMeshes.some(s=>s.material===t.material)),linkedProgramsBefore:before,linkedProgramsAfter:after,additionalLinkedPrograms:after-before,programCache:renderer._pipelines ? {pipelines:renderer._pipelines.pipelines?.size,vertex:renderer._pipelines.programs?.vertex?.size,fragment:renderer._pipelines.programs?.fragment?.size}:null};
  });
 }
 const output={...result,baseline,backend,geometrySHA256,errors};
 fs.writeFileSync(prefix+'.json',JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output,null,2));
 if(errors.length)process.exitCode=1;
}finally{await browser.close();server.close();}
