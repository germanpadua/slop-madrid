"""Clip existing IDEAM parcel volumes to OSM landmark outlines; preserve mapped glass roofs.
Usage: PYTHONPATH=/tmp/madrid-geometry python build-landmark-masses.py INPUT.json OUTPUT.js
Requires shapely. Run prepare-landmark-inputs.mjs first. No geometry is inferred across gaps.
"""
import json,sys,hashlib
from shapely.geometry import Polygon
from shapely.ops import unary_union
j=json.load(open(sys.argv[1]));g=j['seed']
def polygon(flat):return Polygon(list(zip(flat[::2],flat[1::2]))).buffer(0)
def polys(geometry):
 if geometry.is_empty:return []
 if geometry.geom_type=='Polygon':return [geometry]
 if geometry.geom_type in ('MultiPolygon','GeometryCollection'):return [p for c in geometry.geoms for p in polys(c)]
 return []
def flat(coords):return [round(v,3) for xy in list(coords)[:-1] for v in xy]
def record(p,h):return {'ring':flat(p.exterior.coords),'holes':[flat(r.coords) for r in p.interiors],'h':h}
out={};sites={}
for name in ['Banco de España','Palacio de Cibeles','Palacio Real','Teatro Real','Catedral de la Almudena']:
 lm=g['landmarks'][name];source_rings=j.get('outlines',{}).get(name,[])
 outers=[polygon(r['ring'])for r in source_rings if r['role']=='outer'];inners=[polygon(r['ring'])for r in source_rings if r['role']=='inner']
 site=unary_union(outers).difference(unary_union(inners)) if outers else polygon(lm['ring']);levels={}
 if outers and name!='Palacio de Cibeles':
  biggest=max(outers,key=lambda p:p.area);x0,z0,x1,z1=biggest.bounds
  sites[name]={'ring':flat(biggest.exterior.coords),'holes':[[round(v,3)for v in r['ring']]for r in source_rings if r['role']=='inner'],'cx':round((x0+x1)/2,3),'cz':round((z0+z1)/2,3),'w':round(x1-x0,3),'d':round(z1-z0,3),'outlineSource':'assembled OSM relation/way by node IDs'}
 for block in g['parcels']:
  for part in block:
   shape=polygon(part['ring'])
   if not shape.intersects(site):continue
   clipped=shape.intersection(site)
   if clipped.area>0.1:levels.setdefault(part['h'],[]).append(clipped)
 covered=Polygon();parts=[]
 for h,shapes in sorted(levels.items(),reverse=True):
  shape=unary_union(shapes).difference(covered)
  parts.extend(record(p,h) for p in polys(shape) if p.area>0.1)
  covered=covered.union(shape)
 # Use explicit OSM roof profiles for the cathedral's dome and paired bell towers.
 profiles=[]
 if name=='Catedral de la Almudena':
  for way in j['ways']:
   tags=way['tags'];shape=tags.get('roof:shape');roof_height=float(tags.get('roof:height')or 0)
   if shape not in ('dome','pyramidal') or not roof_height:continue
   roof=polygon(way['ring'])
   if not roof.intersects(site):continue
   if way['id']==337694416:
    profiles.append({'ring':flat(roof.exterior.coords),'h':float(tags['height']),'roofHeight':roof_height,'osmWay':way['id'],'shape':shape})
    sites[name]['h']=float(tags['height']);sites[name]['hSrc']='OSM building part337694416'
    continue
   for part in parts:
    foot=polygon(part['ring'])
    if part['h']>50 and foot.intersection(roof).area/foot.area>0.8:
     part['roof']={'shape':shape,'height':roof_height,'osmWay':way['id'],'heightSource':'IDEAM top height with OSM roof:height/profile'}
 glass=[]
 for w in j['ways']:
  t=w['tags']
  if t.get('roof:material')!='glass':continue
  shape=polygon(w['ring']).intersection(unary_union(outers) if outers else site)
  if shape.area<1:continue
  # Explicit levels -> illustrative3.6m storey conversion, not a surveyed roof elevation.
  h=float(t.get('height') or float(t.get('building:levels','4'))*3.6)+float(t.get('roof:height','0'))
  for part in parts:
   patch=shape.intersection(polygon(part['ring']))
   glass.extend({**record(p,part['h']+0.05),'osmWay':w['id'],'heightSource':'existing IDEAM parcel height'} for p in polys(patch) if p.area>0.1)
  missing=shape.difference(covered)
  glass.extend({**record(p,h),'osmWay':w['id'],'heightSource':'OSM height or levels × 3.6m + roof:height'} for p in polys(missing) if p.area>1)
 # Geometry validation: no parcel piece may escape the source outline or overlap another volume.
 for index,part in enumerate(parts):
  geometry=polygon(part['ring'])
  for hole in part['holes']:geometry=geometry.difference(polygon(hole))
  assert geometry.difference(site.buffer(0.01)).area<0.1
  for other in parts[:index]:
   previous=polygon(other['ring'])
   for hole in other['holes']:previous=previous.difference(polygon(hole))
   assert geometry.intersection(previous).area<0.1
 out[name]={'parts':parts,'glass':glass,'roofParts':profiles,'coverage':round(covered.area/site.area,5),'siteArea':round(site.area,3)}
 levels=j.get('buildingLevels',{}).get(name,0)
 if levels and parts:
  dominant=max(parts,key=lambda p:polygon(p['ring']).area)
  out[name]['facadeStorey']=round(max(3,min(8,dominant['h']/levels)),3)
  out[name]['facadeStoreySource']='dominant IDEAM part height / OSM building:levels'
 elif name in ('Palacio Real','Catedral de la Almudena'):
  out[name]['facadeStorey']=7 if name=='Palacio Real' else 6
  out[name]['facadeStoreySource']='illustrative monumental facade spacing; not a surveyed storey height'

header='// Generated from existing Madrid seed IDEAM parcels clipped to OSM landmark rings.\n// Glass roof footprints: OSM/Geofabrik ODbL-1.0; source hash '+j['source']['sha256']+'.\n// Detail heights for glass derived from OSM levels are approximate. No gaps filled.\n'
open(sys.argv[2],'w').write(header+'export const MADRID_LANDMARK_MASSES = '+json.dumps(out,separators=(',',':'))+';\nexport const MADRID_LANDMARK_SITES = '+json.dumps(sites,separators=(',',':'))+';\n')
print({n:{'parts':len(v['parts']),'glass':len(v['glass']),'coverage':v['coverage']} for n,v in out.items()})
