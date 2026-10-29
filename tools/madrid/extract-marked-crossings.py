# Extract explicitly marked OSM crossings; coordinates remain WGS84 until packing.
# Usage: PYTHONPATH=/tmp/madrid-osmium python extract-marked-crossings.py INPUT.pbf OUTPUT.json
import osmium,json,sys
class Crossings(osmium.SimpleHandler):
 def __init__(self):
  super().__init__();self.nodes=[]
 def node(self,n):
  if not n.location.valid(): return
  t=dict(n.tags)
  if t.get('highway')!='crossing': return
  if not (-3.75<n.location.lon<-3.65 and 40.39<n.location.lat<40.46): return
  if t.get('crossing:markings') in ('no','unmarked') or t.get('crossing') in ('no','unmarked'): return
  if t.get('crossing:markings') in ('yes','zebra') or t.get('crossing') in ('zebra','marked'): self.nodes.append([n.id,n.location.lon,n.location.lat,t])
h=Crossings();h.apply_file(sys.argv[1]);json.dump(h.nodes,open(sys.argv[2],'w'));print(len(h.nodes))
