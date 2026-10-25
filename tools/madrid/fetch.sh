#!/bin/bash
# tools/madrid/fetch.sh — download every Madrid source dataset for the selected phase.
# usage: MADRID_PHASE=fase1 bash tools/madrid/fetch.sh [outdir]
# Endpoints & licenses: see MADRID.md. Overpass mirrors are tried in order; each
# response is validated before the atomic rename (same contract as tools/overpass.sh).
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT=${1:-"$DIR/../../tools/data/madrid"}
mkdir -p "$OUT"
CFG="file://$DIR/config.mjs"
PHASE=$(node --input-type=module -e "import {getPhase} from '$CFG'; console.log(getPhase().name)")
WGS=$(node --input-type=module -e "import {getPhase} from '$CFG'; const p=getPhase().wgs84; console.log(\`\${p.yMin},\${p.xMin},\${p.yMax},\${p.xMax}\`)")
UTM=$(node --input-type=module -e "import {getPhase} from '$CFG'; console.log(getPhase().utm.join(','))")
echo "phase $PHASE  wgs84(s) $WGS  utm $UTM -> $OUT"

fetch_overpass() { # fetch_overpass <out.json> <query-file> [tries]
  local OUT=$1 Q=$2 TRIES=${3:-10}
  local TMP; TMP=$(mktemp "${OUT}.tmp.XXXXXX")
  trap 'rm -f -- "$TMP"' EXIT
  for ((i = 1; i <= TRIES; i++)); do
    for ep in https://overpass-api.de/api/interpreter https://overpass.osm.ch/api/interpreter https://overpass.openstreetmap.fr/api/interpreter; do
      if code=$(curl -sS -m 240 -A "slop-madrid/1.0 (three.js city sim)" -o "$TMP" -w "%{http_code}" --data-urlencode "data@$Q" "$ep"); then
        if [ "$code" = "200" ] && node -e '
          const fs = require("node:fs");
          try {
            const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
            if (!Array.isArray(data.elements) || !data.elements.length || data.remark) process.exit(1);
          } catch { process.exit(1); }
        ' "$TMP"; then
          echo "ok $ep try $i size $(wc -c < "$TMP")"
          mv -- "$TMP" "$OUT"
          trap - EXIT
          return 0
        fi
      fi
      echo "try $i $ep -> ${code:-fail}"
      sleep $((i * 3))
    done
  done
  echo "FAILED $OUT" >&2; return 1
}

# 1) OSM: buildings (with height/levels tags), roads, parks, water, plazas, named landmarks.
cat > "$OUT/q_madrid.overpassql" <<EOF
[out:json][timeout:180];
(
  way["building"]($WGS);
  relation["building"]($WGS);
  way["highway"]($WGS);
  nwr["historic"]["name"]($WGS);
  nwr["tourism"]["name"]($WGS);
  nwr["man_made"]["name"]($WGS);
  nwr["amenity"~"fountain|place_of_worship"]($WGS);
  nwr["place"="square"]($WGS);
  way["natural"="water"]($WGS);
  relation["natural"="water"]($WGS);
  way["waterway"]($WGS);
  way["leisure"~"park|garden|pitch|playground"]($WGS);
  way["landuse"~"grass|forest|meadow|recreation_ground"]($WGS);
  way["highway"="pedestrian"]["area"="yes"]($WGS);
);
out geom meta;
EOF
fetch_overpass "$OUT/osm_madrid.json" "$OUT/q_madrid.overpassql"

# 2) Catastro: building footprints with real heights (INSPIRE WFS, 2500 per page, 500 m pages).
python3 "$DIR/catastro.py" "$UTM" "$OUT/catastro_buildings_raw.json"

echo "fetch done."
# 3) Ayuntamiento EDIFICIOS_ALTURAS MapServer: footprints with real heights
#    (EPSG:25830, 2000 features per page, paged with resultOffset).
python3 "$DIR/alturas.py" "$UTM" "$OUT/alturas.json"
