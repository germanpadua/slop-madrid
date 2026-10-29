import { createSourcedStreetTrees } from './madrid-street-trees.js';
import { municipalParkTreePoints, insideMunicipalPark } from './madrid-municipal-tree-points.js';
export function createParkAndStreetTrees(tileId,osmPoints=[]) {
  const municipal=municipalParkTreePoints.get(tileId)||[];
  // Complete inventory owns Retiro; prevent OSM and municipal symbols at the same location.
  const others=municipal.length?osmPoints.filter(p=>!insideMunicipalPark(tileId,p.x,p.z)):osmPoints;
  const group=createSourcedStreetTrees([...others,...municipal]);
  group.userData.municipalCount=municipal.length;
  return group;
}
