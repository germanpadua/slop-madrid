#!/bin/bash
# tools/madrid/fetch.sh — download every Madrid source dataset for the selected phase.
# usage: MADRID_PHASE=fase2 bash tools/madrid/fetch.sh [outdir]
# Endpoints & licenses: see MADRID.md. Overpass mirrors are tried in order for every tile;
# each response is validated before the atomic rename (same contract as tools/overpass.sh).
# The Overpass area is split into a grid of tiles (TILE_GRID, default 3x2) so no single query
# can time out on the phase-2 box, and the tiles are merged into osm_madrid.json.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT=${1:-"$DIR/../../tools/data/madrid"}
mkdir -p "$OUT"
CFG="file://$DIR/config.mjs"
PHASE=$(node --input-type=module -e "import {getPhase} from '$CFG'; console.log(getPhase().name)")
WGS=$(node --input-type=module -e "import {getPhase} from '$CFG'; const p=getPhase().wgs84; console.log(\`\${p.yMin},\${p.xMin},\${p.yMax},\${p.xMax}\`)")
UTM=$(node --input-type=module -e "import {getPhase} from '$CFG'; console.log(getPhase().utm.join(','))")
# Phases are fetched with 3x2 Overpass tiles; a phase-3 tile is ~1.2 km square (2x2).
TILE_GRID=${TILE_GRID:-$([ -n "${MADRID_TILE:-}" ] && [ "${MADRID_TILE}" != "fase2" ] && echo 2x2 || echo 3x2)}
echo "phase $PHASE  wgs84(s) $WGS  utm $UTM  tiles $TILE_GRID -> $OUT"

# Overpass bbox is (south,west,north,east); the tile grid splits it linearly (metres < 1 m off
# the UTM grid at this scale, and OSM geometry is re-projected exactly by tools/madrid/build.mjs).
read -r S W N E <<<"$(echo "$WGS" | tr ',' ' ')"
read -r NX NY <<<"$(echo "$TILE_GRID" | tr 'x' ' ')"

fetch_overpass() { # fetch_overpass <out.json> <query-file> [tries]
  local TARGET=$1 Q=$2 TRIES=${3:-3}
  local TMP; TMP=$(mktemp "${TARGET}.tmp.XXXXXX")
  for ((i = 1; i <= TRIES; i++)); do
    for ep in https://overpass-api.de/api/interpreter https://overpass.osm.ch/api/interpreter https://overpass.openstreetmap.fr/api/interpreter https://overpass.kumi.systems/api/interpreter; do
      local code=""
      if code=$(curl -sS -m 600 -A "slop-madrid/1.0 (three.js city sim)" -o "$TMP" -w "%{http_code}" --data-urlencode "data@$Q" "$ep"); then
        if [ "$code" = "200" ] && node -e '
          const fs = require("node:fs");
          try {
            const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
            if (!Array.isArray(data.elements) || !data.elements.length || data.remark) process.exit(1);
          } catch { process.exit(1); }
        ' "$TMP"; then
          echo "ok $ep try $i size $(wc -c < "$TMP")"
          mv -- "$TMP" "$TARGET"
          return 0
        fi
      fi
      echo "try $i $ep -> ${code:-fail}"
      sleep $((i * 3))
    done
  done
  rm -f -- "$TMP"
  echo "FAILED $TARGET" >&2; return 1
}

# 1) OSM per tile: buildings (with height/levels tags), roads, parks, water (incl. water relations),
#    plazas, named landmarks, rail stations (Atocha, Príncipe Pío) and named POIs.
tiles=()
TILE_LIST=$(node -e '
  const [S, W, N, E, nx, ny] = process.argv.slice(1).map(Number);
  for (let ix = 0; ix < nx; ix++) for (let iy = 0; iy < ny; iy++) {
    const y0 = S + (N - S) * iy / ny, y1 = S + (N - S) * (iy + 1) / ny;
    const x0 = W + (E - W) * ix / nx, x1 = W + (E - W) * (ix + 1) / nx;
    console.log([ix, iy, y0, x0, y1, x1].map((v, i) => (i < 2 ? v : v.toFixed(6))).join(" "));
  }
' "$S" "$W" "$N" "$E" "$NX" "$NY")
while read -r ix iy tS tW tN tE; do
    TWGS="$tS,$tW,$tN,$tE"
    Q="$OUT/q_madrid_${ix}_${iy}.overpassql"
    cat > "$Q" <<EOF
[out:json][timeout:600];
(
  way["building"]($TWGS);
  relation["building"]($TWGS);
  way["highway"]($TWGS);
  node["natural"="tree"]($TWGS);
  node["highway"~"street_lamp|traffic_signals"]($TWGS);
  nwr["railway"~"station|halt"]($TWGS);
  nwr["public_transport"="station"]($TWGS);
  nwr["historic"]["name"]($TWGS);
  nwr["tourism"]["name"]($TWGS);
  nwr["man_made"]["name"]($TWGS);
  nwr["amenity"~"fountain|place_of_worship"]($TWGS);
  nwr["place"="square"]($TWGS);
  way["natural"="water"]($TWGS);
  relation["natural"="water"]($TWGS);
  way["waterway"]($TWGS);
  relation["waterway"]($TWGS);
  way["leisure"~"park|garden|pitch|playground"]($TWGS);
  relation["leisure"~"park|garden"]($TWGS);
  way["landuse"~"grass|forest|meadow|recreation_ground"]($TWGS);
  way["highway"="pedestrian"]["area"="yes"]($TWGS);
);
out geom meta;
EOF
    tile="$OUT/osm_madrid_tile_${ix}_${iy}.json"
    fetch_overpass "$tile" "$Q" 3
    tiles+=("$tile")
done <<<"$TILE_LIST"

# merge tiles (dedupe by OSM type/id; later tiles win, which is harmless for identical elements)
node -e '
  const fs = require("node:fs");
  const [out, ...files] = process.argv.slice(1);
  const els = new Map();
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const e of d.elements || []) els.set(e.type + "/" + e.id, e);
  }
  const elements = [...els.values()];
  fs.writeFileSync(out, JSON.stringify({ version: 0.6, generator: "slop-madrid merge", elements }));
  const byType = elements.reduce((m, e) => ((m[e.type] = (m[e.type] || 0) + 1), m), {});
  console.log(`merged ${elements.length} elements ${JSON.stringify(byType)} -> ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
' "$OUT/osm_madrid.json" "${tiles[@]}"

# 1b) Barrios (admin_level=10) & distritos (admin_level=9) boundaries: districtAt / building profiles / place names.
# Only the seed/phases carry the district layer; a phase-3 tile is drawn by its own geodata.
if [ -n "${MADRID_TILE:-}" ] && [ "${MADRID_TILE}" != "fase2" ]; then
  echo "tile ${MADRID_TILE}: skipping barrios/distritos"
else
  cat > "$OUT/q_barrios.overpassql" <<EOF
[out:json][timeout:300];
(
  relation["boundary"="administrative"]["admin_level"~"^(9|10)$"]($WGS);
);
out geom;
EOF
  fetch_overpass "$OUT/barrios.json" "$OUT/q_barrios.overpassql" 3
fi

# 2) Catastro: building footprints (INSPIRE WFS, 2500 per page, 500 m pages).
python3 "$DIR/catastro.py" "$UTM" "$OUT/catastro_buildings_raw.json"

# 3) Ayuntamiento EDIFICIOS_ALTURAS MapServer: footprints with real heights
#    (EPSG:25830, 2000 features per page, paged with resultOffset).
python3 "$DIR/alturas.py" "$UTM" "$OUT/alturas.json"

echo "fetch done."
