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

## Cómo se verificó

Entorno de esta sesión: **software GL (llvmpipe/Mesa 26.0.8, SwiftShader)**, sin `/dev/dri` dentro del
sandbox; por tanto no hay mediciones de FPS de Iris Xe en esta pasada y las capturas de calle son a
1–3 FPS. Los datos de red, migración y continuidad sí son deterministas (CPU).

```sh
node --test tests/*.test.cjs                       # 179/179
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
  graphSignals 686, assembledMs ~35-45, layoutMs 140-310, lanes 1857 nodos vivos`. Benchmark 12 teselas
  del handoff: 2559 nodos / 3992 aristas.

## Hallazgo: la red heredada de la semilla ya estaba colapsada

Antes de B2, `createTrafficSystem` construía la red con los rectángulos de manzana de `cityGrid.sidewalks`;
en Madrid esos rectángulos son bloques gruesos, no aceras, y la comprobación de carril libre (`LANE_CLEAR`,
más el chequeo de bordillo a 0,3 m) eliminaba casi todo: **6 nodos / 6 aristas** en el arranque. Se
verificó contra el commit anterior `2e71da0` en un worktree limpio: mismo 6/6, luego no es una regresión
de B2. El intercambio a la red residente (que usa las anchuras OSM y la topología por IDs) es lo que hace
que haya coches en la calle. Queda como limitación de la caída a la red heredada si el worker falla.

## Capturas

`street-sol.jpg`, `street-granvia.jpg`, `street-cibeles.jpg` (peatón a las 3 plazas), `tile-k0j-1.jpg`,
`tile-k1j-1.jpg` (calle en tesela con tráfico: taxi, furgonetas, pasos de cebra). Con la GPU software el
cámara de seguimiento tarda en asentarse tras cada teletransporte, así que se usan como evidencia
ilustrativa de tráfico en calle, no como veredicto de paridad con cámara fija; el veredicto visual
por manzanas sigue pendiente (bloque A).

## Riesgos y pendientes de este bloque

- Caída a la red heredada rota (6/6) si el worker no arranca; no hay red de respaldo útil.
- `buildRoadPaint` sigue pintando con la red heredada; las marcas de la semilla no se regeneran con el
  grafo residente (la pintura de teselas es otra).
- Reconstrucciones en ráfaga: `assembledMs + layoutMs` ~0,2–0,4 s en worker; la rehidratación+fit en
  main es O(aristas) y no se ha medido con GPU real ni móvil.
- Peatones: densidad y calidad de rutas fuera de semilla sin veredicto visual con navegador real.
- El worker importa `road-network.js` (arrastra city-config/geodata de semilla): heap del worker no
  medido.
