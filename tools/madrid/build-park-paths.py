"""Buffer real OSM walking paths, clip to Retiro park/core, subtract mapped water.
Unspecified widths use an illustrative2.5m, not a surveyed width.
"""
import sys,json,re
from shapely.geometry import Polygon,LineString,box
from shapely.ops import unary_union
j=json.load(open(sys.argv[1]));out={}
def polygon(r):return Polygon(list(zip(r[::2],r[1::2]))).buffer(0)
def polys(g):
 if g.is_empty:return []
 if g.geom_type=='Polygon':return [g]
 if g.geom_type in ('MultiPolygon','GeometryCollection'):return [p for c in g.geoms for p in polys(c)]
 return []
def flat(c):return [round(v,3) for xy in list(c)[:-1] for v in xy]
for tile in j['tiles']:
 park=unary_union([polygon(r) for p in tile['parks'] for r in p['rings']])
 core=unary_union([box(*r) for r in tile['core']]);park=park.intersection(core)
 water=unary_union([polygon(r) for r in tile['water'] if len(r)>=6]);park=park.difference(water)
 paths=[];ids=[]
 for w in j['ways']:
  line=LineString(w['points'])
  if not line.intersects(park):continue
  width=w['tags'].get('width','');m=re.match(r'^\s*(\d+(?:[.,]\d+)?)\s*(?:m)?\s*$',width)
  width=float(m.group(1).replace(',','.')) if m else 2.5
  if not 0.5<=width<=20:width=2.5
  shape=line.buffer(width/2,cap_style='flat',join_style='mitre').intersection(park)
  if shape.area>0.1:paths.append(shape);ids.append(w['id'])
 merged=unary_union(paths).simplify(0.08,preserve_topology=True)
 assert merged.difference(park.buffer(0.1)).area<0.1
 out[tile['id']]={'ways':ids,'polygons':[{'ring':flat(p.exterior.coords),'holes':[flat(r.coords) for r in p.interiors]} for p in polys(merged) if p.area>0.1]}
header='// Generated OSM/Geofabrik walking paths, ODbL-1.0; clipped to Retiro and tile cores.\n// Unspecified widths illustrated as2.5m. Source '+j['source']['sha256']+'.\n'
open(sys.argv[2],'w').write(header+'export const MADRID_PARK_PATHS = '+json.dumps(out,separators=(',',':'))+';\n')
print({k:{'ways':len(v['ways']),'polygons':len(v['polygons'])} for k,v in out.items()})
