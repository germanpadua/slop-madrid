"""Fetch official park-tree points by explicit OBJECTIDs. Raw responses stay in /tmp.
Usage: python fetch-park-trees.py IDS.json OUTPUT.json
Source: Ayuntamiento de Madrid, Arbolado Parques Históricos PV24, CC BY4.0.
"""
import json,sys,subprocess,concurrent.futures,urllib.parse,hashlib
ids=json.load(open(sys.argv[1]))['objectIds']
url='https://sigma.madrid.es/hosted/rest/services/MEDIO_AMBIENTE/ARBOLADO/MapServer/8/query'
def fetch(chunk):
 params={'f':'json','objectIds':','.join(map(str,chunk)),'outFields':'OBJECTID,ALTURA','returnGeometry':'true','outSR':'25830'}
 data=subprocess.check_output(['curl','-fsSL','--max-time','60',url, '--data', urllib.parse.urlencode(params)])
 j=json.loads(data)
 if 'error' in j:raise RuntimeError(j['error'])
 if j.get('exceededTransferLimit'):raise RuntimeError('incomplete tree batch')
 features=j['features']
 if len(features)!=len(chunk):raise RuntimeError('missing requested tree records')
 return features
chunks=[ids[i:i+1500] for i in range(0,len(ids),1500)]
features=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 for result in pool.map(fetch,chunks):features.extend(result)
assert len({f['attributes']['OBJECTID'] for f in features})==len(ids)
out={'source':{'provider':'Ayuntamiento de Madrid','layer':'Arbolado Parques Históricos PV24','url':url.rsplit('/',1)[0],'license':'CC-BY-4.0','queried':'2026-10-29','coordinateReference':'EPSG:25830'},'features':features}
raw=json.dumps(out,separators=(',',':')).encode();open(sys.argv[2],'wb').write(raw)
print({'features':len(features),'sha256':hashlib.sha256(raw).hexdigest()})
