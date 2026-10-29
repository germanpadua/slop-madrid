"""Pack official Retiro tree points; exact duplicates use median reported height.
Quantization: positions0.1m, heights0.25m. Original IDs retained as deltas.
"""
import sys,json,hashlib,statistics,struct,zlib,base64
from shapely.geometry import Point,Polygon
from shapely.ops import unary_union
raw=open(sys.argv[1],'rb').read();source=json.loads(raw);parks=json.load(open(sys.argv[2]));ox,oy=parks['originUTM'];duplicates={}
for f in source['features']:
 p=f['geometry'];key=(round(p['x'],2),round(p['y'],2));duplicates.setdefault(key,[]).append(f['attributes'])
out={};total=0
for tile in parks['tiles']:
 rings=[r for p in tile['parks'] for r in p['rings']]
 park=unary_union([Polygon(list(zip(r[::2],r[1::2]))).buffer(0) for r in rings]);origin=[tile['core'][0][0],tile['core'][0][1]];rows=[]
 for (e,n),records in duplicates.items():
  x,z=e-ox,oy-n
  if not any(a<=x<b and c<=z<d for a,c,b,d in tile['core']) or not park.covers(Point(x,z)):continue
  heights=[]
  for r in records:
   try:h=float(str(r['ALTURA']).replace(',','.'))
   except(ValueError,TypeError):continue
   if 0<h<60:heights.append(h)
  h=statistics.median(heights) if heights else 0
  rows.append((min(r['OBJECTID']for r in records),round((x-origin[0])*10),round((z-origin[1])*10),round(h*4)))
 data=bytearray();last=0
 for oid,x,z,h in sorted(rows):
  delta=oid-last;last=oid
  while delta>=128:data.append((delta&127)|128);delta>>=7
  data.append(delta);data.extend(struct.pack('<HHB',x,z,min(255,h)))
 packed=base64.b64encode(zlib.compress(bytes(data),9)).decode()
 out[tile['id']]={'origin':origin,'count':len(rows),'rings':rings,'data':packed};total+=len(rows)
header='// Ayuntamiento de Madrid, Arbolado Parques Históricos PV24, CC BY4.0.\n// '+source['source']['url']+'\n// Raw source SHA256 '+hashlib.sha256(raw).hexdigest()+'. Duplicates at same centimetre: median height.\n// Position0.1m, height0.25m quantization; glyph crown sizes are illustrative.\n'
open(sys.argv[3],'w').write(header+'export const MUNICIPAL_PARK_TREES = '+json.dumps(out,separators=(',',':'))+';\n')
print({'trees':total,'perTile':{k:v['count']for k,v in out.items()},'bytes':len(open(sys.argv[3],'rb').read())})
