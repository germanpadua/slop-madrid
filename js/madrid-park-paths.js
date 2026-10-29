import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MADRID_PARK_PATHS } from './madrid-park-paths-data.js';
let material;
export function createMappedParkPaths(tileId) {
  const data=MADRID_PARK_PATHS[tileId];
  if(!data?.polygons.length) return null;
  material ||= new THREE.MeshStandardNodeMaterial({color:0xc3b394,roughness:1,metalness:0});
  const geos=[];
  const path=(ring,Type)=>{
    const p=new Type();p.moveTo(ring[0],-ring[1]);
    for(let i=2;i<ring.length;i+=2)p.lineTo(ring[i],-ring[i+1]);p.closePath();return p;
  };
  for(const poly of data.polygons){
    const shape=path(poly.ring,THREE.Shape);
    for(const hole of poly.holes)shape.holes.push(path(hole,THREE.Path));
    geos.push(new THREE.ShapeGeometry(shape).rotateX(-Math.PI/2).translate(0,0.145,0));
  }
  const geometry=mergeGeometries(geos,false);for(const g of geos)g.dispose();
  const mesh=new THREE.Mesh(geometry,material);mesh.name=`MappedParkPaths:${tileId}`;
  mesh.receiveShadow=true;mesh.userData.osmWays=data.ways.length;return mesh;
}
