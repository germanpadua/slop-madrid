# slop-madrid — plan de adaptación (fork de mrdoob/slop-newyork)

Fork del simulador GTA-style de Manhattan (three.js WebGPURenderer + TSL, 1:1) a Madrid.
Objetivo por fases: **fase 1** centro (~1 km²: Sol, Gran Vía, Cibeles, Alcalá), **fase 2**
almendra central (mismo pipeline, bbox mayor), **fase 3** término municipal (solo plan).

## Cómo funciona el original (auditoría, 25-10-2026)

- **Datos**: `tools/build-geodata.mjs` + `tools/geo-*.mjs` generan un único módulo
  `js/nyc-geodata.js` que exporta `GEO` (schema abajo). Fuentes: NYC Open Data (CSCL
  centerline, borough boundaries, parks) + OSM Overpass (Central Park, piers, coastline,
  landmarks). Los datos crudos están **commiteados** en `tools/data/` (fetchers:
  `tools/overpass.sh` + queries `.overpassql`; los datasets NYC se descargaron a mano de
  data.cityofnewyork.us). Los tests (`tests/geodata.test.mjs`) solo exigen
  `roadGraph.links.length>0` y `blocks.length>0`.
- **Frame**: 1 unidad = 1 m; x = este, z = sur; origen 5th Ave & 42nd St; ejes girados
  29,02° (la retícula de Manhattan). `GEO.frame.bearingDeg/cutZ` son leídos por la app.
- **Consumo**: `js/city-config.js` reconstruye el mundo en **import-time** (se evalúa al
  cargar el módulo; 14 módulos lo importan). Consumers: city-config, city-grid,
  buildings, boroughs, landmarks, road-network, street-details, nyc-map, road-paint,
  traffic (vía city-config), controllers, tsl-materials, audio-sources, gamepad-controls.
- **Pub**: GitHub Pages desde la raíz del repo (sin workflow: `index.html` en la raíz,
  pages sirven main). `gh-pages`/workflow no existe en upstream.

### Schema GEO consumido (campos load-bearing)

| Campo | Consumo | Madrid |
|---|---|---|
| `frame{cutZ,bearingDeg}` | city-config | bearingDeg=0 (Sol), cutZ=borde norte del bbox |
| `manhattan` | SHORE x-at-z, seawall, ISLAND_BOUNDS, agua | anillo del bbox fase 1 |
| `streets[{n,z,segs}]` | coreSt exige n∈{58,53,48,45,42,38,34,28,23} | se reescribe city-config |
| `avenues[{id,x,segs,names}]` | coreAve exige ids 8/7/6/5/park/lex/3 | se reescribe city-config |
| `broadway` | getBroadwayX por manzana (buildings.js) | Gran Vía como "broadway" |
| `blocks[[poly,rects,park,parkName,rect,frames]]` | aceras + lotes + edificios procedurales | de manzanas OSM |
| `roads[[name,w,dir,lanes,hw,pts]]` | ROADS, mapas, road graph | de OSM highway |
| `roadGraph{nodes,links,names}` | red drivable no-reticulada | de OSM (todo) |
| `plazas/parks/centralPark/piers/islands/boroughs/bridges/points/landmarks` | varios; **crash si faltan claves NYC** | stubs vacíos seguros + reescrituras |

## Plan de implementación (fase 1)

1. **Generador Madrid** `tools/madrid/` (parametrizado por fase/bbox):
   - `config.mjs`: fases `fase1`/`fase2` con bbox UTM30N + WGS84 (pyproj, `bbox.py`).
   - `fetch.sh`: Overpass (`osm_madrid.json`: buildings/highway/water/parks/squares,
     con `out geom`) + Catastro INSPIRE WFS `Building` (huellas UTM30N, `catastro.py`)
     + Ayuntamiento `EDIFICIOS_ALTURAS` MapServer (ALTURA real, `alturas.py`).
   - `build.mjs`: OSM+Catastro → `js/madrid-geodata.js` con el **mismo schema GEO**
     (WGS84→frame local: origen Puerta del Sol, sin rotación, north = -z).
2. **Desacoplo NYC en la app** (reescritura honesta, no stubs falsos):
   - `city-config.js`: sustituir avenidas numeradas/`coreAve/coreSt`/`districtAt`/
     bridges/piers/teleports NYC por datos GEO Madrid (calles principales como
     "avenues" = las de `GEO.roads` con mayor anchura; distritos = barrios reales).
   - `city-grid.js`: desactivar Central Park/Battery/waterfront edge/viaducto FDR
     (bloques NYC incondicionales según auditoría); agua solo si hay hydraulic data.
   - `landmarks.js`: extrusión genérica de huellas reales (Altura/OSM) en lugar de los
     12 modelos manuales NYC; ` boroughs.js`: solo el polígono del bbox + buildable.
3. **Alturas reales**: los edificios del original son 100% procedurales por manzana
   (no leen alturas). Madrid añade canal de datos: `blocks` con `rects` y **alturas por
   lote desde Catastro/EDIFICIOS_ALTURAS**, consumido en `buildings.js::mass()`
   (punto único de extrusión), con fallback procedural donde no hay dato.
4. **Hitos con malla realista (i3s IDEAM)**: ver sección abajo.
5. **Verificación**: servidor local + Playwright headless (ver "Verificación").
6. **Pub**: Pages del fork apuntando a `feat/madrid` (preview), merge a main pendiente
   del usuario.

## Fuentes de datos Madrid

| Fuente | Qué | Uso | Licencia/términos |
|---|---|---|---|
| OSM Overpass | edificios (height/levels), highways, parks, agua, plazas | geometría base | ODbL, © colaboradores |
| Catastro INSPIRE WFS (`ovc.catastro.meh.es/inspire/wfsBU.aspx`) | huellas de edificios (GML, EPSG:25830), `numberOfFloorsAboveGround` parcial | alturas cuando no hay dato mejor | reutilización libre con atribución (IApoD, RC insancción art. 12: "© IGN/Catastro") |
| Ayuntamiento MapServer `CARTOGRAFIA/EDIFICIOS_ALTURAS` | huellas con `ALTURA` (m, z-suelo) y `Z_EDIFICIO_HUELLA` | **alturas primarias** | © Ayuntamiento de Madrid (IDEAM), uso libre con atribución |
| IDEAM i3s `MODELADO_3D_MADRID` (SceneServer tiles-eu1.arcgis.com) | malla realista 3D por nodos (LOD tree, EPSG:4326) | hitos (opcional) | © Ayuntamiento de Madrid; descarga por nodos, sin API key |
| BBBike Madrid.osm.pbf (77 MB) | respaldo OSM completo | si Overpass cae | ODbL |

Equivalencias NYC→Madrid: CSCL→OSM highway+EDIFICIOS_ALTURAS(anchos), DCP boroughs→
límites del bbox/almendra, NYC Parks→OSM leisure/park, Central Park features→parques
de la zona (no hay equivalente central: bucle genérico), piers→nada (sin río navegable
en fase 1; Manzanares en fase 2-3).

## Modelo 3D realista (i3s) — hallazgos del timebox (45')

**Viable.** Escena correcta encontrada: la experiencia ArcGIS "Modelo-3D-realista" usa
el Web Scene `d8bcbe7422a048a6837dafad300ef2be` (MODELO_3D_REALISTA_PUBLICO), cuyo
servicio principal es:

- `https://tiles-eu1.arcgis.com/UrtTdLP2PYSxwtI6/arcgis/rest/services/MODELADO_3D_MADRID/SceneServer/layers/0`
- `store.profile = meshpyramids` (i3s 1.10), quadtree `nodes/root` → children → hojas
  `nodes/<id>/geometries/0` (gzip, PerAttributeArray: position Float32 WGS84 lon/lat/z,
  normal, uv0, color UInt8) + `features/0` (id, position, mbb, layer="Building") +
  `shared` (materials vertexColors) + `attributes/0`. Acceso **anónimo**, sin key.
- Extensión: todo el municipio (4326: -3.88..-3.52, 40.31..40.64). Campos:
  OBJECTID, ID_3D, CAPA, NIVEL, ORIGEN, FECHA_ALTA, **ALTURA**.
- Decodificación verificada en vivo: nodo hoja 3587 (6000 vértices, 27 features) se
  parsea con `gzip + struct` (~200 KB/hoja); las posiciones caen en el bbox correcto.
- El zip municipal completo (`MODELADO_3D_MADRID.zip`) pesa **2,2 GB** — no descargar
  (disco 13 G). La vía por nodos permite traer solo las hojas que intersecan los hitos
  (Puerta de Alcalá, Cibeles, Sol): decenas de MB como mucho.
- Otras escenas descartadas: `Hosted/Escena_WSL1` (piloto 860×390 m en la sierra,
  ~40.53°N, unidades ft), `MODELO_3D_VECTORIAL`, BIM, nube de puntos (no hitos centro).

Integración fase 1: fetcher `tools/madrid/i3s.py` (trae hojas por bbox de hito),
conversión a un paquete de meshes con colisión aproximada; **el fork base funciona sin
ellas** (fallback = huella Catastro/OSM + altura real).

## Escalado (fase 3 — plan, no implementado)

- **Partición**: cuadrícula UTM 1 km del término (≈606 km², ~640 tiles). Pipeline ya
  parametrizado por bbox → corrección por tile; un manifiesto (`tiles.json`) lista
  tiles con extent, counts y sha. Overpass no escala a 640 llamadas: usar extracto
  pbf diario (BBBike/Geofabrik) recortado con `osmium` por tile (CPU, segundos/tile).
- **Catastro/Alturas**: WFS y MapServer paginados ya implementados; para el municipio
  completo descargar por distrito (~21 peticiones MapServer con where por distrito).
- **LOD**: nivel 0 = máscara de suelo + manzanas simplificadas (todo el municipio,
  ~50 MB); nivel 1 = edificios extruidos con altura Catastro por tile; nivel 2 =
  detalle de fachada procedural cerca de cámara. i3s municipal como capa opcional de
  hitos (ya por nodo).
- **Carga diferida**: fetch por tile con `AbortController` + cache HTTP inmutable
  (hash en la URL); Web Workers para parseo; presupuesto memoria <1.5 GB.
- **Volúmenes estimados**: ~250-350 k huellas Catastro (Altura), ~500 k edificios OSM,
  ~60 k nodos vía. GEO actual es 1 módulo inline (1,1 MB para 59 km²): por fases el
  peso total estimado 60-120 MB — obliga a tiles por red, no un solo JSON.
- **Cambios de código necesarios**: consumidor GEO por-tile (streaming), culling por
  tile en scene-culling, tráfico/red por grafo global con tiles activos, sistema de
  parque/agua global. Nada de esto en fase 1-2.

## Verificación

- Datos: `node tools/madrid/build.mjs` sale a `js/madrid-geodata.js`; tests
  `tests/madrid-geodata.test.mjs` (schema, frame, counts no vacíos).
- App: `npx http-server` (o `python3 -m http.server`); Playwright headless: sin
  errores de consola/red; WebGPU probablemente no disponible headless → se documenta
  hasta dónde llega el boot (módulos + overlay + construcción de ciudad vía
  `buildCityGrid` con datos Madrid); el render 3D real se valida en navegador real.
