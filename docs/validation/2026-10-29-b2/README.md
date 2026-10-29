# B2 — red de circulación residente en worker y agentes migrados (2026-10-29)

Bloque B2 de `PARIDAD-PLAN.md`: sacar la preparación de la red residente del hilo de animación,
conectarla a coches/peatones y retirar rutas al descargar teselas sin dejar agentes inválidos.

## Qué se implementó

- `js/madrid-road-worker.js` + `js/madrid-road-preparer.js`: un Module Worker reutilizado ensambla
  el grafo residente (`buildResidentRoadGraph`) y los carriles OSM (`buildRoadNetwork(..., {roadGraph,
  sourceOnly:true, coverage})`) a partir de las vías de la semilla y de cada tesela montada.
- `js/road-network.js`: el constructor síncrono expone su fábrica de consultas de suelo
  (`createGroundQueries`) y una entrada de rehidratación (`hydrateRoadNetwork`); el puente
  worker↔main usa `encodeRoadNetwork`/`decodeRoadNetwork`, datos planos indexados. El grafo vivo es
  cíclico (nodo↔arista↔movimiento↔brazo↔nodo) y su structured clone desbordaba la pila; el formato
  plano clona en milisegundos y reconstruye adyacencia, brazos, movimientos y curvas de carril en main.
- `js/madrid-road-network.js`: servicio residente versionado y con debounce (320 ms). Cada snapshot
  lleva vías (solo tags que lee la política) y cobertura (núcleo semilla + núcleos de teselas); las
  respuestas obsoletas se descartan. También aporta el lookup de bloques de teselas para peatones y
  combina `seedBlockAt || residentBlockAt`. Los bordillos NO se envían al worker: con los rectángulos
  de manzana de Madrid el grafo colapsaba a 6 aristas (ver "Hallazgo").
- `js/traffic.js`: `setNetwork(next, blockAt)` cambia la red viva, reinicializa contadores de nodos y
  ocupación, remapea cada vehículo por posición+rumbo (`js/madrid-road-matching.js`) y retira los que
  no tienen carril equivalente (se reubican al reaparecer). No reconstruye población ni mallas.
- `js/pedestrian-system.js`: `setNetwork(next, blockAt)` rehace rutas peatonales, vacía caminantes y
  bordillos, cierra conversaciones y remapea/retira peatones.
- `js/main.js`: crea el servicio tras el streamer, refresca con `onStatus` y aplica la red al tráfico
  (`window.__madrid.roadStats` para QA).
- `js/road-paint.js` + `js/main.js`: las marcas de calzada siguen a la red viva. `createRoadPaint` adopta
  la malla de arranque y en cada swap cambia solo la geometría (un material, sin recompilar shader,
  geometría anterior liberada, grupo único). Históricamente el residente decodificado traía `paintEdges: []`, así que
  se pintan las aristas de routing y se reconstruye la bandera de curva desde los brazos.
- `roadStats.timings`: `snapshotMs`, `workerMs` (ida y vuelta del worker), `applyMs` y su reparto en main
  (`queriesMs`, `decodeMs`, `blockLookupMs`), medidos en el mismo swap que mueve agentes.

## Cómo se verificó

Entorno de esta sesión: **software GL (llvmpipe/Mesa 26.0.8, SwiftShader)**, sin `/dev/dri` dentro del
sandbox; por tanto no hay mediciones de FPS de Iris Xe en esta pasada y las capturas de calle son a
1–3 FPS. Los datos de red, migración y continuidad sí son deterministas (CPU).

```sh
node --test tests/*.test.cjs                       # 180/180
PLAYWRIGHT_MODULE=... CHROME_PATH=... node tools/madrid/check-circulation.mjs --timeout 240000
```

Resultados de la última pasada (`circulation.json`):

| Paso | aristas red | coches colocados | peds | stale car/ped | tiles alcanzadas (saltos desde Sol) |
|---|---|---|---|---|---|
| semilla tras arranque | 2884 / 1857 nodos | 200 | 171 | 0 / 0 | k0j-1 39, k1j-1 42, k2j-1 36, k3j-1 44, k3j0 56 |
| en k1j-1 | 2884 | 200 | 171 | 0 / 0 | + k3j-1 37 |
| en k0j-1 | 2933 / 1880 | 200 | 171 | 0 / 0 | k0j-1 40 |
| en k2j-1 | 3070 / 1976 | 200 | 171 | 0 / 0 | k3j0 56 |
| vuelta a semilla (7 teselas) | 3431 / 2215 | 200 | 171 | 0 / 0 | k4j0 70 |
| tras descargar 6 teselas | 2154 / 1419 | 200 | 171 | 0 / 0 | k0j-1 40, k0j3 29 |

- Continuidad: todos los nodos vivos son alcanzables desde Sol (saltos finitos arriba); no hay aristas
  dentro del núcleo de ninguna tesela descargada (0 nodos en los 6 núcleos).
- Coherencia de simulación: `badS=0` (ningún vehículo con `s` fuera de su arista), `laneOverhang=0`
  (ningún carril sobresale >0,5 m de la anchura OSM de la vía).
- `roadStats` típicos con 5 teselas: `graphNodes 3526, routingNodes 1857, routingEdges 2884,
  graphSignals 686, assembledMs 18-41, layoutMs 92-310, lanes 1857 nodos vivos`. Benchmark 12 teselas
  del handoff: 2559 nodos / 3992 aristas.
- Coste medido del swap (`boot-timings.json`, mismo swap que aplica la red): worker 162 ms de ida y
  vuelta, **main 4,2 ms** (consultas de suelo 1,9, decode 1,5, lookup de bloques 0,8). El coste de
  rehidratar en main no es el fotograma caro; el layout del worker (~0,1-0,3 s) es el que manda.
- Pintura residente (`paint-granvia.jpg`): en Gran Vía se ven línea doble amarilla, carriles
  discontinuos y el paso de cebra del cruce siguiente, alineados con los carriles que usan los coches.
  Coste por swap: 14-40 ms, 24-42k vértices / 1 malla, geometría anterior liberada.

## Hallazgo: la red heredada de la semilla ya estaba colapsada

Antes de B2, `createTrafficSystem` construía la red con los rectángulos de manzana de `cityGrid.sidewalks`;
en Madrid esos rectángulos son bloques gruesos, no aceras, y la comprobación de carril libre (`LANE_CLEAR`,
más el chequeo de bordillo a 0,3 m) eliminaba casi todo: **6 nodos / 6 aristas** en el arranque. Se
verificó contra el commit anterior `2e71da0` en un worktree limpio: mismo 6/6, luego no es una regresión
de B2. El intercambio a la red residente (que usa las anchuras OSM y la topología por IDs) es lo que hace
que haya coches en la calle. Queda como limitación de la caída a la red heredada si el worker falla.

## Capturas

`street-sol.jpg`, `street-granvia.jpg`, `street-cibeles.jpg` (peatón a las 3 plazas), `tile-k0j-1.jpg`,
`tile-k1j-1.jpg` (calle en tesela con tráfico: taxi, furgonetas, pasos de cebra) y `cibeles-fixed.jpg`
(cámara de seguimiento ya asentada en Cibeles, `inspect-scene.mjs --place cibeles --shot ...`). Con GPU
software la cámara tarda varios frames en asentarse tras cada teletransporte; por eso las capturas de
la ronda de circulación son ilustrativas y `cibeles-fixed.jpg` es la única con encuadre estable.

Defectos visuales observados en el encuadre estable de Cibeles (para los bloques A/C, no de B2):

- El "cubo blanco" junto al Palacio de Cibeles era la **huella OSM de la Fuente de Cibeles** extruida
  como edificio; ahora es pavimento plano (`landmarks-cibeles.jpg`, `65322f3`).
- El pavimento de la plaza y del suelo en general no tiene juntas/textura a esta distancia (candidato
  de detalle de calle, bloque C).

## Landmarks genéricos: fachada y Fuente de Cibeles (`65322f3`)

Los polígonos OSM de landmark sin monumento procedural (`js/landmarks.js`) se extrudaban con un color
liso: la "monotonía de fachadas" y, en Cibeles, el **cubo blanco** que resultó ser la huella OSM de la
propia **Fuente de Cibeles** extruida a su altura de escultura. Cambios:

- Un material de fachada compartido para todos esos cuerpos: retícula de ventanas (bays 2,7 m, plantas
  3,55 m), antepecho sólido en la última planta, juntas de forjado, zócalo de granito y cornisa, todo
  derivado de la posición mundial del fragmento y del tinte/altura que viajan en los UV. Un solo
  material y un solo shader para que `batchStaticGroupMeshes` siga fusionando (el batching conserva
  position/normal/uv). Templos/monumentos/estatuas conservan el cuerpo plano: solo es trabajo de fachada.
- `Fuente` deja de extruirse: se dibuja como pavimento plano (mantiene su collider) para no darle
  fachada a una fuente. El cubo desaparece de la glorieta (`landmarks-cibeles.jpg`). En
  `landmarks-linares.jpg` se ven las ventanas de un cuerpo genérico junto a manzanas con balcones.

Riesgos: material de fachada validado a 1-3 FPS software; AA por `fwidth` y aspecto en GPU real sin
veredicto; los landmark sin `ring` o con `h` dudoso siguen con la extrusión genérica.

## Riesgos y pendientes de este bloque

- Resuelto después de esta evidencia: el fallo del worker activa la preparación del snapshot actual en main (`27e6f10`); puede causar una pausa. Ver ../2026-10-29-road-recovery/.
- Resuelto después de esta evidencia: la pintura sigue el grafo residente y conserva sus aristas físicas (`27e6f10`). Ver ../2026-10-29-hardware-circulation/.
- Reconstrucciones en ráfaga: `assembledMs + layoutMs` ~0,2–0,4 s en worker; la rehidratación+fit en
  main es O(aristas) y no se ha medido con GPU real ni móvil.
- Peatones: densidad y calidad de rutas fuera de semilla sin veredicto visual con navegador real.
- El worker importa `road-network.js` (arrastra city-config/geodata de semilla): heap del worker no
  medido.