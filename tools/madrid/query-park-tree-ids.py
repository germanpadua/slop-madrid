"""Query official municipal tree IDs in the source park polygons. Output remains a raw cache.
Usage: python query-park-tree-ids.py PREPARED-PARKS.json IDS.json
"""
import json,sys,urllib.parse,subprocess
parks=json.load(open(sys.argv[1]));ox,oy=parks['originUTM'];rings=[]
for tile in parks['tiles']:
 for park in tile['parks']:
  for flat in park['rings']:
   ring=[[flat[i]+ox,oy-flat[i+1]]for i in range(0,len(flat),2)];ring.append(ring[0]);rings.append(ring)
geometry={'rings':rings,'spatialReference':{'wkid':25830}}
url='https://sigma.madrid.es/hosted/rest/services/MEDIO_AMBIENTE/ARBOLADO/MapServer/8/query'
params={'f':'json','where':'1=1','geometry':json.dumps(geometry,separators=(',',':')),'geometryType':'esriGeometryPolygon','inSR':'25830','returnIdsOnly':'true'}
raw=subprocess.check_output(['curl','-fsSL','--max-time','60',url,'--data',urllib.parse.urlencode(params)])
data=json.loads(raw)
if 'objectIds'not in data:raise RuntimeError(data)
data['queryGeometry']=geometry
open(sys.argv[2],'w').write(json.dumps(data,separators=(',',':'))+'\n')
print({'objectIds':len(data['objectIds'])})
