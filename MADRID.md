# slop-madrid — plan de adaptación (fork de mrdoob/slop-newyork)

Fork del simulador GTA-style de Manhattan (three.js WebGPURenderer + TSL, 1:1) a Madrid.
Objetivo por fases: **fase 1** centro (~1,9 km²: Sol, Gran Vía, Cibeles, Alcalá) — completada;
**fase 2** almendra central oeste (8,45 km²: Manzanares, Debod, Palacio Real, Atocha) — completada el
27-10-2026; **fase 3** teselado del interior de la M-30 y carga diferida (8 teselas, 15,2 km²
residentes de las 52,1 km² del ámbito) — completada el 27-10-2026; **fase 4** término municipal
(~606 km², las 77 celdas pendientes del manifiesto) — solo plan, ver "Escalado".

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
  (a pesar del nombre "realista", es LOD2 extruido de cubiertas — NO malla fotogramétrica; veredicto más abajo)
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

**Estado 2026-10-28 (verificado en vivo)**: fetcher implementado (`tools/madrid/i3s.py <nombre> <lon0,lat0,lon1,lat1> <outdir>`): recorre el quadtree, descarga hojas por bbox y decodifica el buffer. Layout confirmado: cabecera `uint32 vertexCount, uint32 featureCount`, posiciones `f32 x3` **offsets relativos al centro mbs del nodo** (lon/lat en grados, z en metros), normales `f32 x3`, uv0 `f32 x2`, color `u8 x4`, ids de feature al final. Puerta de Alcalá: 5 hojas, 18,6 MB en bruto, vértices verificados dentro del bbox (-3.6866, 40.4188, 667 m). Pendiente: paquete runtime (GLB diezmado) + proyección a mundo + chequeo pixel.
**Veredicto de fidelidad 2026-10-28 (verificado)**: el modelo municipal es **LOD2 extruido de cubiertas de EDIFICIOS** — los MONUMENTOS en plaza abierta NO están: 0 vértices en ±35-47 m del centro de la Puerta de Alcalá (-3.68878, 40.42003) en las 5 hojas que cubren su bbox. Sirve como capa opcional de cubiertas del tejido general, NO para hitos reconocibles. Licencia verificada: CC BY 4.0 (https://datos.madrid.es/dataset/300722-0-ancho-viario-mapas, campo "Licencia"; condiciones https://datos.madrid.es/pages/condiciones-generales-ayuntamiento-de-madrid) — reutilización y redistribución permitidas CON ATRIBUCIÓN (© Ayuntamiento de Madrid) si algún día se publica malla derivada. Conclusión: monumentos reconocibles = modelado procedural propio (estilizado, coherente con el juego); i3s queda como mejora opcional de cubiertas.

Evidencia de vinculación licencia↔malla (por si algún día se publica malla derivada): la página de dataset cuya URL lleva el slug histórico `300722-0-ancho-viario-mapas` tiene por **título real** "Modelo tridimensional de edificaciones de la cartografía base municipal" (responsable: Dirección General de Planificación Estratégica, publicado 22-nov-2024), y su pestaña Descargas enlaza el Geoportal, cuyos recursos I3S/SLPK apuntan a `.../I3S_SLPK/MODELADO_3D_MADRID.zip` — el mismo modelo que sirve el SceneServer. La licencia CC BY 4.0 de esa ficha es por tanto la del modelo; queda anotada la cadena slug→título→zip por la falta de licencia en el propio servicio ArcGIS. Veredicto acotado a ESTE servicio municipal: no cierra preguntas de fidelidad/licencia de otras fuentes i3s.
Corrección de diagnóstico: los monumentos del centro NO estaban "en teselas sin construir" — están en la semilla fase2 (`GEO.landmarks`, 42 sitios extruidos) con materiales por nombre desde d61392e; solo Puerta de Alcalá falta del conjunto (ver nota de gate x=1208 abajo). NOTA 2026-10-28 tarde: la frase original decía que «la cubre esta vía i3s» — FALSO según el veredicto de fidelidad de arriba: el i3s municipal tiene 0 vértices en la huella de la Puerta. La vía de malla real para monumentos es el prototipo ZONA* 3DTilesServer (fotogrametría municipal; Puerta verificada completa y georreferenciada ~0,6 m; derivados SOLO locales hasta cerrar licencia por elemento).

Integración fase 1: fetcher `tools/madrid/i3s.py` (trae hojas por bbox de hito),
conversión a un paquete de meshes con colisión aproximada; **el fork base funciona sin
ellas** (fallback = huella Catastro/OSM + altura real).

## Escalado (fase 4 — plan, no ejecutado)

La fase 3 dejó hecha la infraestructura (manifiesto, pipeline por tesela, propiedad de geometría, streams y
presupuesto de memoria); la fase 4 es llenar el término municipal.

- **Partición**: la cuadrícula de fase 3 (1 km, solape 100 m) ya cubre la almendra y el manifiesto tiene las 77
  celdas pendientes con su bbox; el término completo (≈606 km²) son ~640 celdas con la misma parametrización
  (`tools/madrid/tiles.mjs`). Overpass no escala a 640 llamadas: usar extracto pbf diario (BBBike/Geofabrik)
  recortado con `osmium` por tile (CPU, segundos/tile) y dejar Overpass para las celdas sueltas.
- **Catastro/Alturas**: WFS y MapServer paginados ya implementados y parametrizados por bbox; para el municipio
  completo conviene descargar por distrito (~21 peticiones MapServer con where por distrito) y recortar.
- **LOD**: la fase 3 ya separa dos niveles (semilla con masificación procedural de manzana; tesela con una caja de
  fachada por parcela). Fase 4: nivel 0 = máscara de suelo + manzanas simplificadas para lo lejano (~50 MB para
  el municipio); i3s municipal como capa opcional de hitos (ya investigado por nodo).
- **Tráfico y minimapa por tesela**: hoy el grafo de tráfico y el minimapa son de la semilla; extenderlos requiere
  un grafo global con tiles activos (los `roads` de cada tesela ya se emiten con nombre, ancho y carriles).
- **Carga diferida**: el presupuesto (12 MB / 12 teselas) y el `?v=<md5>` de los módulos ya están; para el
  municipio conviene subir el presupuesto y parsear en Web Workers (hoy el parseo va en el hilo principal, ~30-150
  ms por tesela).
- **Volúmenes medidos en fase 3**: 0,115–0,65 MB por tesela densa (media 0,4 MB/km²), ~2 900 parcelas y ~80
  manzanas por km² en la almendra construida. El municipio completo a este LOD ≈ 200–300 MB: por red, nunca un
  solo JSON.

## Referencia Tiny Warsaw (28-10-2026, engine notes de tinywarsaw.app/preview/engine/)

El usuario pasó tinywarsaw.app como referencia. Proyecto comparable: escalaron de 49 km² a 332 km² (924 celdas de
600 m, 141 617 edificios, 2,14 M árboles) manteniendo la carga usable en móvil. Lo que ya coincide con este repo:
un módulo por celda + manifiesto, URLs versionadas, presupuesto por bytes y el extracto regional OSM
(Geofabrik/osmium) previsto para la fase 4. Lo adoptado y lo anotado:

- **Adoptado (28-10-2026)**: prefetch con anticipación por velocidad en `planTiles` (~6 s por delante del vector de
  la cámara, tope 1,5× el radio; las expulsiones miden desde la posición real). Sus cifras: frames con una celda
  sin construir en vuelo, 26 → 0. Test nuevo en `tests/madrid-tiles.test.cjs`.
- **Para fase 4**: niveles lejanos preconstruidos en el pack (edificios bajos pintados en la textura del suelo,
  >25 m como bloques, KTX2 con fallback WebP): su vista completa en móvil bajó de 4,58 M a 0,36 M triángulos y de
  761 a 12 draw calls. Es la forma madura de nuestro "nivel 0" ya esbozado arriba y sustituiría el plano "fuera de
  mapa" por ciudad lejana real.
- **Riesgo señalado**: probaron WebGPU y lo descartaron por más lento que WebGL en su desktop y un Samsung S23.
  Este fork es WebGPU+TSL: el rendimiento en móvil físico hay que validarlo en el dispositivo del usuario.
- **Ideas menores**: reveal temprano + brillo sutil en celdas cargando; suelo con malla gruesa en zonas planas
  dentro de una tolerancia de altura; malla de suelo recortada bajo las calzadas y horneada en el pack;
  árboles como shaders/impostores (aún no hay árboles aquí); alojamiento en Cloudflare Workers con ficheros <25 MiB.

## Verificación

- Datos (semilla): `node tools/madrid/build.mjs` sale a `js/madrid-geodata.js` +
  `js/madrid-geodata-blocks.js`; tests `tests/madrid-geodata.test.cjs` (fase, cobertura
  del bbox, agua real, hitos con alturas, parcelas dentro del frame y fuera del cauce).
- Datos (teselas): `node tools/madrid/tiles.mjs manifest|build <ids…>|verify` genera el
  manifiesto, fetch+construye las celdas y comprueba md5/tamaño; tests
  `tests/madrid-tiles.test.cjs` (cobertura y disjunción de los cores sobre el polígono de la
  M-30, hashes, geometría completa en los bordes, dedupe entre teselas, política de carga y
  presupuesto). `node tools/madrid/measure.mjs` mide carga/streaming/frame cost en headless.
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

## Estado fase 3 (27-10-2026) — teselado y expansión al interior de la M-30

### Resultado

- **Manifiesto** `tools/madrid/tiles.json` (generado por `node tools/madrid/tiles.mjs manifest`): cuadrícula UTM30N
  paramétrica de celdas de 1 000 m con **solape de descarga de 100 m**, anclada en la esquina SO de la fase 2
  (438 450, 4 472 800), ids `k<i>j<j>`. 85 celdas tocan el interior de la M-30: 8 `ready` (semilla + 7 nuevas),
  77 `pending` (fase 4). Cada entrada lleva core, fetch, bbox WGS84, estado, md5, bytes y conteos.
- **Ámbito medido sobre OSM**: el interior del anillo de la M-30 son **52,11 km²** (incluye Casa de Campo; la
  almendra construida que se cita habitualmente ronda 40 km²). No hay contorno dibujado a mano.
- **7 teselas nuevas** (Retiro ×2, Salamanca este, Arganzuela, Latina, Moncloa, Chamartín sur), mismas fuentes y
  mismo pipeline que la fase 2: **6,75 km² nuevos, 2,74 MB**. Con la semilla: 8 teselas, 15,2 km², **6,47 MB**.
- **Carga diferida**: prefetch a 1 600 m, descarga a 2 600 m, presupuesto duro de **12 MB / 12 teselas** que nunca se
  supera; la semilla no se descarga nunca; lo pendiente se pinta con la textura de "fuera de mapa".
- **Consistencia**: cada manzana y cada huella tiene un dueño único, agua y parques se recortan al core, y hay tests
  que comprueban cobertura, disjunción, ausencia de geometría cortada y ausencia de duplicados entre teselas.

### El ámbito: interior de la M-30 (geometría real)

- Fuente: ways OSM con `ref=M-30` (1 520 segmentos a menos de 9 km de Sol; `tools/data/madrid/m30.json`, regenerable
  con `node tools/madrid/tiles.mjs fetch-m30`).
- Ráster de 40 m con barrera de 30 m a cada lado de la calzada y flood-fill 4-conectado desde la Puerta del Sol.
- El anillo no es cerrado al norte: la M-30 continúa como Avenida de la Ilustración (A-6) y A-1, así que el relleno se
  recorta en `z = −6 300 m` (ápice norte del anillo, `almendra.capZ` en el manifiesto). Sin ese tope el relleno se
  escapa por los enlaces y mide 55,8 km² de corredores que no son almendra.
- Contorno = aristas de celda del relleno + RDP 20 m → 314 vértices en coordenadas de mundo.

### Manifiesto (`tools/madrid/tiles.json`)

- `grid`: origen (esquina SO de la fase 2), `cell` 1 000 m, `overlap` 100 m, `seed: "fase2"`.
- `almendra`: `ring` ([x, z] de mundo), `areaKm2`, `maskAreaKm2`, `capZ`.
- `budget`: 12 MB, 12 teselas, `preloadRadius` 1 600 m, `dropRadius` 2 600 m.
- `tiles[]`: `id`, `label`, `status`, `core` (rectángulos [x0, z0, x1, z1] en metros de mundo), `cell`/`fetch` (UTM),
  `bboxWgs84`, `module`, `md5`, `bytes`, `counts` (manzanas, parcelas, parques, agua, vías, hitos), `areaKm2`,
  `sources`. La semilla `fase2` conserva el contrato de fase 2 (`js/madrid-geodata.js` +
  `js/madrid-geodata-blocks.js`) con sus md5.
- Core de la semilla = caja de fase 2 (3 250 × 2 600 m); fetch = caja + 100 m. Las celdas que la tocan llevan el core
  partido en 1–2 rectángulos, de modo que todos los cores son disjuntos y cubren el polígono (test).
- `node tools/madrid/tiles.mjs verify` compara md5 y tamaño de cada módulo con el manifiesto (8/85, 6,47 MB).

### Teselas generadas

| id | zona | km² | manzanas | huellas IDEAM | parques | agua | hitos* | módulo |
|---|---|---|---|---|---|---|---|---|
| `k3j1` | Retiro oeste (Atocha, Jerónimos) | 0,75 | 14 | 476 | 295 | 7 | 33 | 119 KB |
| `k4j1` | Retiro este (Retiro, Salamanca sur) | 1,00 | 81 | 2 828 | 66 | 5 | 12 | 390 KB |
| `k4j2` | Salamanca este (Guindalera, Fuente del Berro) | 1,00 | 81 | 4 851 | 61 | 0 | 18 | 677 KB |
| `k2j-1` | Arganzuela (Delicias, Legazpi) | 1,00 | 98 | 3 823 | 41 | 1 | 13 | 488 KB |
| `k0j-1` | Latina (Casa de Campo este, Manzanares sur) | 1,00 | 77 | 1 665 | 105 | 2 | 8 | 280 KB |
| `k0j3` | Moncloa (Argüelles, Moncloa) | 1,00 | 71 | 2 531 | 50 | 2 | 28 | 440 KB |
| `k2j4` | Chamartín sur (Nuevos Ministerios) | 1,00 | 70 | 2 727 | 84 | 5 | 23 | 415 KB |

\* entradas de `landmarks` con huella; sólo se extruyen las que tienen altura real. Fuentes por tesela: Overpass
(© OpenStreetMap, ODbL), IDEAM `EDIFICIOS_ALTURAS` (© Ayuntamiento de Madrid) y Catastro INSPIRE (© IGN/Catastro).
Total 2,74 MB de módulos de tesela; semilla 721 KB + 3,09 MB.

### Pipeline por tesela

- `MADRID_TILE=<id> bash tools/madrid/fetch.sh tools/data/madrid/tiles/<id>`: Overpass en 2×2 (misma consulta que la
  fase 2, dedupe por `type/id`), Catastro INSPIRE paginado y EDIFICIOS_ALTURAS paginado. Los barrios se omiten (sólo
  los usa la semilla). Una descarga fallida marca la celda `failed` en el manifiesto y el resto sigue.
- `MADRID_DATA=<dir> MADRID_TILE=<id> node tools/madrid/build.mjs js/geodata/tile-<id>.js`: misma proyección
  (`tools/madrid/projection.mjs`, extraída para compartirla con `tiles.mjs`), mismo ráster de 2 m y misma morfología
  de manzanas que la fase 2.
- **Propiedad** (dedupe entre teselas, sin duplicar ni recortar geometría): el ráster de manzanas se ancla a una
  cuadrícula global de 100 m (no a la caja de cada tesela), así la misma manzana se traza idéntica en todas las
  teselas que la llevan. Una manzana completa pertenece a la tesela con **más de la mitad de su área** en el core —
  eso decide losas y aceras. Las **fachadas** (una caja por huella) pertenecen siempre a la tesela cuyo core contiene
  el **centro de la huella**, esté o no sobre una manzana: dos builds con datos de días distintos pueden trazar
  manzanas ligeramente distintas en una costura, y atar las fachadas a la manzana emitía la misma huella desde dos
  teselas (detectado 28-10-2026 en la costura k0j-1/k1j-1, corregido en `build.mjs`); el centro de la huella no
  depende de la segmentación. Manzanas que tocan el borde de descarga se descartan (estarían cortadas); parques y
  agua se recortan al core (Sutherland–Hodgman por rectángulo); hitos por centroide; los vanos de puente por el
  punto medio del segmento (un vano se dibuja una vez).
- La semilla se regeneró con el mismo pipeline y 100 m de solape (`build-seed`): sus bordes ya no llevan manzanas
  cortadas, y las manzanas del anillo de solape pertenecen a la tesela vecina, que las dibuja enteras.
- Salida: módulo autocontenido `export const TILE = {id, label, core, frame, blocks, parcels, parks, water, roads,
  landmarks}` (una sola petición por tesela).

### Motor: carga diferida y fusión

- `js/madrid-tiles.js`: `planTiles()` puro (testeado en Node) decide qué cargar y qué descargar;
  `createTileStreamer()` pide el manifiesto, importa el módulo de cada tesela (`import()` con `?v=<md5>`, caché
  inmutable) y lo entrega al mundo. Reglas: sólo `ready`; prefetch ≤1 600 m; descarga >2 600 m; topes duros
  12 MB / 12 teselas (si no cabe, no se carga); la semilla nunca se descarga; ≤3 importaciones en vuelo; un reintento
  por tesela y después se deja; actualización autolimitada a 20 m / 400 ms; la tesela se construye entera antes de
  entrar en la escena (sin parpadeo).
- `js/madrid-tile-world.js`: geometría por tesela con **los mismos materiales** que la semilla (`cityMaterials`; las
  fachadas salen de `FACADE_DEFS`, cacheadas por opciones ⇒ ninguna compilación de shader extra al entrar una tesela):
  losa de asfalto de 0,6 m con el agua real como agujero, lámina de agua a −0,45 m, césped real a 0,10 m, aceras
  (bordillo + losa) de la manzana catastral, una caja de fachada por huella IDEAM con su ALTURA, hitos extruidos sólo
  con altura real, tableros de puente a cota 0 y un guardián de huellas ya dibujadas.
- Suelo "fuera de mapa": plano bajo todo el ámbito (rejilla de 50/250 m sobre zócalo oscuro) visible en las celdas
  pendientes; nunca se confunde con suelo urbano ni deja huecos grises.
- Colisionadores: las huellas de cada tesela entran en la lista viva y `controllerManager.refreshColliders()` reindexa
  el mapa espacial.
- Diagnóstico opt-in: `?debug=1` expone `window.__madrid` (renderer, escena, streamer, mundo, cámara) para
  `tools/madrid/measure.mjs`.

### Rendimiento medido (Chromium headless, SwiftShader, arm64)

`node tools/madrid/measure.mjs --tiles k3j1,k4j1,k4j2,k2j-1,k0j-1,k0j3,k2j4` (servidor estático local, perfil nuevo,
`?debug=1`):

| Métrica | Medida | Nota |
|---|---|---|
| Arranque hasta el primer frame | 173,5 s | de los cuales **151 s son el primer frame en SwiftShader** (la GPU software encola una sola vez el render completo); no es una cifra de GPU real |
| Fases CPU del arranque | 5,75 s en total | `renderer 468 · lighting 109 · cityGrid 1 438 · boroughs 242 · landmarks 28 · blocks 985 · streetDetails 850 · traffic 919 · roadPaint 164 · **tiles 109** · controllers 7 · culling 360 · ui 70 · postFX 238` |
| Capa de teselas en el arranque | **109 ms** | petición del manifiesto (10 KB) + mundo de teselas + suelo "fuera de mapa"; **no** descarga ninguna tesela de datos |
| Import + construcción por tesela | 28–711 ms (mediana ≈ 150 ms) | primera vez en frío (descarga incluida): 1,4–1,7 s; 500 KB de módulo ≈ 150 ms |
| Teselas residentes tras recorrer el ámbito | 7 (semilla + 6) | 3,17 MB contabilizados en el presupuesto (de 12 MB); 0 fallos de carga |
| Mallas de una tesela | 7–12 | tapa, agua, césped, aceras, 3 lotes de fachadas instanciadas, tablero de puente |
| Coste de frame con 6 teselas + semilla | **511 draw calls, 3,57 M triángulos** | cámara en el Retiro, incluye los pases de sombra; la fase 2 se midió con otro harness (46 draw calls / 0,48 M triángulos), no comparable directamente |
| FPS | no medible en headless | el rasterizador software tarda ~150 s en un frame; la tasa de cámara a 60 fps queda pendiente de validar en navegador con GPU (igual que en fase 2) |
| Errores de página / peticiones fallidas | 0 / 0 | los avisos `Binding size … is zero` son de SwiftShader y ya existían en fases anteriores |

**Carga inicial y objetivo < 3 s**: no se cumple en esta máquina (5,75 s de CPU hasta el primer frame, antes de compilar
shaders). El teselado no la empeora (109 ms); el coste está en la construcción procedural del mundo de la semilla
(`cityGrid` + `blocks` + `streetDetails` + `traffic` ≈ 4,2 s). En una GPU real la compilación de shaders (~12,4 s aquí)
baja a ~2 s (medido en fase 2), pero el límite sigue siendo la CPU de la instancia ARM; queda como trabajo de
optimización (Web Workers para el parseo, LOD de la semilla).

Cada tesela aporta 7–12 mallas (las fachadas van instanciadas en tres lotes) y sus huellas como instancias: el coste de
vértices escala con los edificios de la tesela, no con el tamaño del ámbito, y el culling deja en pantalla sólo las
cercanas. Ampliar radios/budget es un valor del manifiesto, no un cambio de código.

### Tests

`timeout 900 node --test 'tests/*.test.cjs' tests/geodata.test.mjs` → **123/123** (114 previos + 9 nuevos en
`tests/madrid-tiles.test.cjs`):

- cobertura del polígono de la M-30 por los cores (≥2 000 puntos muestreados, exactamente un dueño por punto) y
  disjunción de todos los cores (semilla incluida);
- manifiesto: esquema, área, `capZ`, md5/tamaño de cada módulo contra el fichero;
- geometría completa: ninguna manzana cortada en un borde de descarga, ninguna huella con dos vértices sobre una
  línea de recorte, todo lo que se emite pertenece al core o a una manzana suya;
- dedupe: ninguna huella ni manzana aparece en dos teselas;
- streaming: prefetch dentro del radio, descarga más allá del radio, la semilla nunca se descarga, topes de bytes y
  de número de teselas respetados.

### Limitaciones conocidas (fase 3)

- **LOD de tesela**: una caja de fachada por huella IDEAM (sin masificación procedural, cornisas, balcones ni
  cubiertas). La semilla mantiene el detalle alto; las teselas son un nivel intermedio.
- **Tráfico y minimapa** siguen siendo de la semilla: las teselas aportan suelo, manzanas, edificios, parques, agua y
  vanos, no carriles, rutas ni capa de mapa.
- **Celdas pendientes**: sólo hay 7 vecinas generadas; las otras 77 celdas del manifiesto se pintan como "fuera de
  mapa" (nunca como ciudad vacía) hasta la fase 4.
- **Costuras con celdas pendientes**: la manzana que cabalga sobre una celda pendiente la dibuja la celda vecina; si esa
  vecina aún no está generada, la manzana no se ve (su suelo lo cubre la tapa de la tesela cargada o el "fuera de
  mapa"). Al generar la celda, la manzana entra entera, sin cortes.
- **Hitos sin altura** no se extruyen (no se inventan); las entradas de `landmarks` incluyen POIs con nombre sin
  volumen.
- **Agua y parques** se recortan al core: una mancha que cruza una costura se dibuja en dos mitades exactas, sin
  solape ni z-fighting.
- **Vecinos de la semilla**: al regenerarla con 100 m de solape, las manzanas del anillo pertenecen a las celdas
  vecinas (488 manzanas interiores en la semilla), de modo que una parte del borde de fase 2 se completa al cargar esas
  celdas.


## 2026-10-28 — Artefacto de bandas en el cielo: estado de la investigación

- Las bandas luminosas visibles en capturas NO son el puente de Williamsburg ni los
  puentes del East River: `EAST_RIVER_BRIDGES` y `OUTER_BRIDGES` están vacíos desde
  f017b7f y los builders de boroughs.js no construyen nada. Cualquier atribución
  previa a cables de puente queda retirada (vivía solo en notas de trabajo).
- Evidencia reunida: sin meshes con NaN, sin InstancedMesh corruptos, sin
  Points/Sprites/Lines, nada sobre la cámara en 200 m; raycast preciso hacia las
  bandas solo toca el SkyMesh; persisten tras ocultar el root PlayerHelicopter y
  HighwayTraffic. El disco de rotor del helicóptero sí produce estelas propias
  (controllers.js, blurDisc) cuando la cámara chase queda bajo él.
- Hipótesis abierta (NO conclusión): banding del shader procedural de nubes del
  SkyMesh bajo el backend WebGL2. Contexto: ?capture fuerza WebGL2
  (main.js: `captureFrame` implica `forceWebGL`) y el navegador cloud carece de
  WebGPU (`navigator.gpu === false`), así que TODA captura local es WebGL2 y no se
  puede descartar ni confirmar el artefacto en la experiencia pública WebGPU desde
  ese navegador. El A/B con cloudCoverage=0 en página pesada quedó descartado (5 caídas de pestaña;
  ruta agotada). Diagnóstico acotado del código del SkyMesh: proyección de horizonte
  sensible a precisión (cloudUV = direction.xz/(direction.y·elev), hash fract), pero
  las bandas se observaron ALTAS en el cielo (pitch 25-45°), así que no lo explica
  limpiamente: sin causa verificada.

## 2026-10-28 — Losa blanca de las vistas NE = Palacio de Cibeles (geometría deficiente, no NYC)

- La gran caja blanca al este de la Puerta de Alcalá en las vistas NE quedó
  identificada por raycast Möller–Trumbore desde la cámara (1344,27,-293):
  impacto en malla de `Landmarks` (material eae3d1) en (1066,49,-276), dentro de
  la huella OSM del **Palacio de Cibeles** (x 948-1066, cx 1006.8, cz -221.2,
  w 119.6 × d 133, h IDEAM 63.8). No es geometría de NYC ni un artefacto de
  captura: es un hito madrileño real renderizado como extrusión genérica lisa
  de 63.8 m (js/landmarks.js), un ejemplo directo de la queja del usuario de que
  los edificios/monumentos no encajan con el estilo de Madrid.
- Bug de convención corregido en landmarks.js: las huellas se construían en
  espacio (x, +z), pero rotateX(-PI/2) exige (x, -z) (city-grid.js:222), así que
  TODA huella asimétrica de hito y todo pavimento de plaza asimétrico quedaba
  espejado N-S respecto a las calles. Las plazas rectangulares (Independencia,
  Cibeles) no lo delataban por simetría. Corregido a (x, -z) en los dos sitios
  (extrusión y pavimento).
- Palacio de Cibeles v1 procedural (monuments.js): referencias públicas
  (Patrimonio y Paisaje, Ayto. de Madrid; CentroCentro) - cuerpo blanco
  neoplateresco de 5 plantas (~28 m) sobre la huella real OSM, cuerpo superior
  retranqueado, dos torres pentagonales flanqueando la fachada principal
  achaflanada hacia la fuente, cimborrio octogonal del reloj de 70 m real
  (modelo: 72 m con chapitel), chapiteles de pizarra, pináculos y pórtico de
  columnas al Paseo del Prado. Colisionador: bbox de la huella con maxY 72.


## Fachada madrileña procedural (2026-10-28, 3a87920 + 2efed51)

- `createPreWarBuildingMaterial` acepta `madrid: true` (flag aislado, NYC/NJ intactos): rejas de
  forja en el tercio inferior de los vanos altos en vez de guillotina, sin unidades de AA, sin faja
  de cornisa cada 6 plantas (se conservan fascia de bajos y copete), zócalo de piedra en planta baja.
  Cableado en js/madrid-tile-world.js para los paquetes de parcelas.
- Medianeras: cuando una parcela colindante es más baja, el lienzo por encima de su cubierta se emite
  como piso apilado `WALL_KINDS.lotLine` (medianera ciega, sin vanos). Vecinos solo dentro de la
  tesela (aproximación acotada; bordes entre teselas conservan frente de calle).
- **Validación visual pendiente de mapa completo**: los cambios están verificados por píxeles en un
  harness que importa los módulos reales del juego (material + instanciado de cajas + opciones
  MADRID_FACADE_OPTS) sobre la manzana real #315, NO en el mapa completo. La captura headless del
  arranque completo es inviable en este sandbox (compilación TSL bajo SwiftShader > 120 s de límite
  por comando; los hijos detached se terminan al salir; sin cron/dbus de usuario). Verificación real
  pendiente en navegador con GPU.
- Coste medido (submit CPU, 1280x720 SwiftShader, mediana de 15): +0,30 ms por frame con `madrid:true`.
  Sin cambio de geometría; el coste GPU no se puede aislar en SwiftShader.

## Tejados (hip roofs, 2026-10-28)
Madrid residential parts (prewar/walkup) get instanced terracotta hip roofs (tejado a cuatro aguas, 6 tris/roof) instead of NYC water towers: 72% of SINGLE-SPAN parcels (max span <= 24m), ridge along the long axis, 0.6m eaves overhang, 8% slate variant; the rest and ALL large footprints keep a flat roof with a small bulkhead. Patio blocks (min span > 24m AND h <= 22; towers stay single-mass hips) get a perimeter roof RING with a visible patio opening (16 tris/roof): this fixed the first rollout's AABB-spanning megahip/flat-deck, which was visually rejected as an industrial shed. Collision containment: a ring falls back to flat when another parcel pokes through its inner-slope band (AABB-only model; tile path sees only same-tile neighbors). Roofs render in BOTH the procedural seed (js/buildings.js hipRoofs) and the phase-3 tile renderer (js/madrid-tile-world.js section 4b, same rules/hash). Grounded in Tiny-Madrid illustrated references (user-chosen); harness-verified (block-roof.html). FULL-MAP VISUAL VALIDATION OUTSTANDING.
