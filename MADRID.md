# slop-madrid — plan de adaptación (fork de mrdoob/slop-newyork)

Fork del simulador GTA-style de Manhattan (three.js WebGPURenderer + TSL, 1:1) a Madrid.
Objetivo por fases: **fase 1** centro (~1,9 km²: Sol, Gran Vía, Cibeles, Alcalá) — completada;
**fase 2** almendra central oeste (8,45 km²: Manzanares, Debod, Palacio Real, Atocha) — completada el
27-10-2026; **fase 3** término municipal (solo plan).

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

- Datos: `node tools/madrid/build.mjs` sale a `js/madrid-geodata.js` +
  `js/madrid-geodata-blocks.js`; tests `tests/madrid-geodata.test.cjs` (fase, cobertura
  del bbox, agua real, hitos con alturas, parcelas dentro del frame y fuera del cauce).
- Datos crudos **no versionados** (`tools/data/madrid/*.json`, ~55 MB en fase 2):
  se regeneran con `MADRID_PHASE=fase2 bash tools/madrid/fetch.sh` (Overpass por
  teselas 3x2, Catastro WFS paginado, IDEAM MapServer paginado, barrios 9/10).
- App: `npx http-server` (o `python3 -m http.server`); Playwright headless: sin
  errores de consola/red; WebGPU probablemente no disponible headless → se documenta
  hasta dónde llega el boot (módulos + overlay + construcción de ciudad vía
  `buildCityGrid` con datos Madrid); el render 3D real se valida en navegador real.

## Estado fase 1 (25-10-2026)

- **Pipeline**: `tools/madrid/fetch.sh` → Overpass (osm_madrid.json, espejos
  overpass-api.de → osm.ch → overpass.kumi.systems), `catastro.py` (WFS INSPIRE,
  2445 huellas EPSG:25830), `alturas.py` (IDEAM EDIFICIOS_ALTURAS, 10814 huellas con
  ALTURA); `node tools/madrid/build.mjs` → `js/madrid-geodata.js` (1,49 MB: 879 roads,
  139 blocks, 11412 parcels con altura 2,4–82,6 m, 231 landmarks).
- **App**: alturas IDEAM clampean la extrusión procedural por parcela en
  `buildings.js::commit()` (storeys enteros); profiles por barrio
  (MADRID_CENTRO/GRANVIA/JERONIMOS); 8 teleports verificados programáticamente
  (Sol, Callao, Gran Vía, Cibeles, Alcalá, Plaza Mayor, Ópera) sobre calzada real
  mirando a su referencia.
- **Tests**: 106/106 (`timeout 300 node --test 'tests/*.test.cjs'
  tests/geodata.test.mjs`), incluidos los teleports reescritos para Madrid.
- **Smoke headless** (Playwright chromium headless-shell, arm64): la app arranca
  con `navigator.gpu` presente, 0 pageerrors y 0 peticiones fallidas; el render
  WebGPU efectivo queda por validar en un navegador con GPU (headless-shell expone
  el adaptador pero puede caer a fallback). No se captura frame.
- **Limitaciones conocidas**: Puerta de Alcalá queda 16 m fuera del bbox fase 1
  (gate en x=1208 vs xMax=1191.7): no está en `GEO.landmarks` ni en el mapa; el
  teleport "Alcalá" aterriza en la calzada de Alcalá dentro del frame. i3s
  (MODELADO_3D_MADRID) diferido a fase 2 (fetcher por nodos ya investigado, arriba).
- **Publicación**: GitHub Pages (workflow, build_type=workflow) despliega
  `feat/madrid` y `main`; URL https://germanpadua.github.io/slop-madrid/. Merge a
  `main` pendiente del usuario.

## Estado fase 2 (27-10-2026) — almendra central

### Fase activa y bbox

`MADRID_PHASE` por defecto es **fase2** (`tools/madrid/config.mjs`). El bbox que traía
el borrador (`439316,4473866,441428,4474730`) medía **1,82 km²** — no crecía respecto a
fase 1 (1,90 km²) y **dejaba fuera** el Templo de Debod (x 439103), Príncipe Pío
(x 438844), Atocha (y 4473100) y Reina Sofía al sur: cuatro de los ocho hitos pedidos.
Se sustituye por:

| | UTM 30N | WGS84 |
|---|---|---|
| fase 2 | `438450, 4472800, 441700, 4475400` | lon −3,725351…−3,687292 · lat 40,403537…40,427193 |

3,25 × 2,60 km = **8,45 km² (4,4× fase 1)**, con el Manzanares dentro del frame y los
ocho hitos. Los WGS84 salen de la inversa de la serie transversal de Mercator (la misma
que usa `build.mjs`), comprobados contra pyproj.

### Datos descargados (`MADRID_PHASE=fase2 bash tools/madrid/fetch.sh`)

| Fuente | Resultado fase 2 | fase 1 |
|---|---|---|
| Overpass (6 teselas 3×2, `out geom meta`) | 18 199 elementos, 15,2 MB — 2 792 polilíneas de vía (2 182 con nombre), 635 parques, 51 masas de agua (12 por relación multipolígono), 116 plazas | 5,7 MB |
| Catastro WFS INSPIRE (42 páginas de 500 m) | 8 110 huellas (respaldo) | 2 445 |
| IDEAM `EDIFICIOS_ALTURAS` (18 páginas de 2 000) | **34 440 huellas con ALTURA** | 10 814 |
| Barrios OSM (`admin_level` 9/10) | 19 límites administrativos | — |

`fetch.sh` cambió: tesela el bbox de Overpass (una consulta por tesela, fusión con dedupe
por `type/id`), añade estaciones de ferrocarril, `leisure`/`natural` por relación y
barrios; 4 espejos con 3 intentos (el principal devolvió 502 una vez, `overpass.osm.ch`
respondió). Los JSON crudos (~55 MB) **no se versionan**: `.gitignore` los excluye y se
regeneran con el script.

### Pipeline (`tools/madrid/build.mjs`)

- **Agua**: sólo áreas (`natural=water`, `water=*`, `waterway=riverbank` o `area=yes`);
  antes cualquier `waterway` contaba como polígono y una vía cerrada de `waterway=river`
  (OSM 1340243106) excavaba 15 ha falsas. Las relaciones se cosen miembro a miembro
  (`stitchOuterRings`) y todo se recorta al frame (Sutherland-Hodgman) → **29 polígonos,
  0,120 km² dentro**, con el cauce del Manzanares de 333 vértices.
- **Manzanas y lotes**: las huellas IDEAM se rasterizan a 2 m, se cierran/abren
  (close 4 / open 9) para obtener las manzanas (507) y, con el ráster **sin morfología**
  como máscara, se cubre cada manzana con rectángulos codiciosos de 12 m → **4 435 lotes**
  que caen sobre la huella catastral real (3,41 km² de 3,38 km² de huellas).
- **Alturas**: 22 hitos toman la ALTURA de la parcela IDEAM que los contiene (muestreo 6×6
  del footprint); el resto usa `height`/`building:levels` de OSM y se marca `hSrc:'OSM'`.
- **Barrios**: `GEO.barrios` con el polígono real; `city-config.js::districtAt` lo prueba
  como polígono antes de las cajas, y la Gran Vía se detecta con el corredor de `ROADS`.
- **Salida partida**: `js/madrid-geodata.js` (712 KB: frame, manzanas como lista de
  rectángulos, vías, grafo, parques, agua, barrios, hitos) + `js/madrid-geodata-blocks.js`
  (3,26 MB: manzanas + parcelas). Ambos van en `modulepreload`; el contrato
  `import { GEO } from './js/madrid-geodata.js'` no cambia.

### Motor

- **Cauce real**: el suelo es una losa de 0,6 m con los polígonos de agua como **agujeros**
  (`Shape.holes` + `ExtrudeGeometry`), así el cauce queda excavado con banco vertical y la
  superficie del río a −0,45 m. Los viales que cruzan el agua reciben su tablero a cota 0
  (**26 vanos**) para que el tráfico no circule sobre el hueco. Ya no hay anillo cuadrado
  ni foso decorativo.
- **Parques**: las 654 superficies de `GEO.parks` se dibujan como césped a 0,10 m en una
  sola malla fusionada, con el agua recortada como agujero en Madrid Río.
- **Edificios**: fase 1 no construía ninguno (`rects: []` en cada manzana). Ahora cada
  manzana lleva sus lotes reales y `buildings.js` crea 4 786 complejos con la altura
  IDEAM por parcela. Se restauraron además `tone`/`shops` en `commit()`, borrados por
  error en el commit de fase 1 (referencia a variable inexistente).
- **Minimapa**: capa de agua real (`L.water`) sobre el suelo.

### Hitos de la almendra

| Hito | Huella (m) | Altura | Fuente |
|---|---|---|---|
| Templo de Debod | 91 × 41 | — (sin altura inventada) | OSM ring |
| Palacio Real | 169 × 273 | 45,7 | IDEAM |
| Catedral de la Almudena | 135 × 107 | 65,4 | IDEAM |
| Plaza de España | 334 × 272 | — (plaza) | OSM plaza |
| Museo Reina Sofía | 246 × 196 | 14,4 | OSM levels |
| Estación de Atocha | 463 × 463 | 30,4 | IDEAM |
| Estación de Príncipe Pío | 120 × 154 | 35,9 | IDEAM |
| Gran Vía | 1 285 m (x −619…666) | — | OSM vías + corredor |

Teleports nuevos (verificados sobre calzada real, mirando al hito): `palacio`, `debod`,
`principepio`, `reinasofia`, `atocha`.

### Rendimiento medido (Chromium headless, SwiftShader, arm64)

| Métrica | fase 1 | fase 2 |
|---|---|---|
| import `madrid-geodata` | 184 ms | 448 ms |
| import `city-config` (mundo en import-time) | — | 81 ms |
| `buildCityGrid` | 1 910 ms | 2 099 ms |
| `buildCityBlocks` | 275 ms (0 edificios) | 2 330 ms (4 786 complejos) |
| `buildLandmarks` | — | 113 ms |
| mallas / instancias | — | 100 mallas, 42 707 instancias, 23 175 colisionadores |
| por frame (submit SwiftShader) | ~414 k triángulos | ~482 k triángulos, ~46 draw calls |

El coste por frame crece sólo ~16 % pese a 4,4× superficie: `scene-culling.js` ya trocea
los batches estáticos en celdas de 500/1 000 m y los edificios van instanciados por
material. No fue necesario añadir LOD ni carga por capas para esta fase (la referencia de
tinywarsaw — celdas de 600 m con manifiesto, niveles lejanos prebakeados y culling por
sub-chunk de ~225 m — queda como plan para fase 3). El "FPS" de SwiftShader no es una
medida de GPU y no se reporta como tal.

### Verificación de la geometría renderizada

Como el frame no se puede capturar en headless (SwiftShader compila shaders a 2 % y el
`toDataURL` de un canvas WebGPU sale negro), la malla se comprueba **por raycast** sobre el
grafo construido en el navegador (mismo `buildCityGrid`/`buildCityBlocks` de la app):

- 40/40 sondas interiores al cauce (disco de 6 m dentro del agua): suelo a **−0,45 m** y
  ningún tablero encima → el río es un hueco real.
- 40/40 sondas en centros de manzana: losa a **0,0 m**.
- 16/16 cruces de vía sobre el agua (Puente de Segovia, del Rey, de San Isidro, M-30):
  tablero a **0,0 m**.
- 0 de 23 175 colisionadores de edificio dentro del cauce.
- 40 volúmenes de hito, el mayor **129 m** (Torre de Madrid, IDEAM 128,6).
- Parque: una malla fusionada de 4,79 km² de triángulos (4,35 km² de polígonos OSM, el
  resto son solapes de anillos anidados).

### Tests

`timeout 900 node --test 'tests/*.test.cjs' tests/geodata.test.mjs` → **114/114** (106 de
fase 1 + 8 nuevos en `tests/madrid-geodata.test.cjs`: fase/bbox, cobertura tierra+agua,
cauce real (curvatura, área, lado oeste), hitos con alturas y fuente, Gran Vía completa,
parcelas dentro del frame y fuera del agua, crecimiento ~4×, módulo partido).

### Limitaciones conocidas (fase 2)

- **Geometría de edificio = caja**: el material de fachada es instancing de cajas
  (`boxLocal`, atributos `box`/`faces`), así que cada lote es un rectángulo de 12 m sobre
  la huella catastral, no el polígono exacto. El contorno de manzana, la ocupación y la
  altura sí son reales; patios interiores menores de ~8 m se cierran en el ráster.
- **1 354 huellas aisladas (12 ha)** no entran en ninguna manzana (naves, equipamientos
  sueltos) y no se construyen.
- **Templo de Debod sin altura**: no hay parcela IDEAM ni `height` en OSM; se deja sin
  dato antes que inventarlo (el extrusor usa su valor por defecto).
- **Puente/baden**: los 17 vanos son tableros planos a cota 0; no hay barandillas ni
  geometría de puente.
- **i3s** (`MODELADO_3D_MADRID`) sigue diferido: los hitos se extruyen de su huella real.
- Errores de consola de WebGPU en headless (`Binding size … is zero`) son **previos**
  (también aparecen con los datos de fase 1) y del entorno SwiftShader; 0 pageerrors.
