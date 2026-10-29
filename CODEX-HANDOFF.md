# Continuar paridad Madrid — traspaso 2026-10-29

## Arranque obligatorio

Repositorio real de esta sesión: `/home/germanpadua/proyectos/slop-madrid/slop-madrid` (subcarpeta del workspace). Verificar `pwd`, `git status --short`, `git branch --show-current`, `git log -8 --oneline` antes de editar. Rama **feat/paridad**. Último commit de implementación **7233bbc** (B2); el commit que contiene este handoff es posterior. No quedan cambios de implementación a medio editar al escribirlo.

Leer `PARIDAD-PLAN.md` y `MADRID-PARIDAD.md`: son el estado y la auditoría. `PRODUCT.md`, `MADRID.md`, `MADRID-PROGRESS.md` y `docs/validation/` aportan contexto histórico. El anterior handoff de wip/madrid-experience se conserva en `git show f40e310:CODEX-HANDOFF.md`; sus autorizaciones de push y rama ya NO aplican.

## Objetivo y restricciones vigentes

Madrid debe alcanzar un nivel compartible comparable a **TinyWarsaw**, preferido explícitamente por el propietario sobre NYC. No dar por terminado por tener tests verdes o una captura mejor. Falta ciudad viva fuera de semilla, detalle con fuente, revisión de patios/monumentos, cobertura y rendimiento móvil. Mantener flat shading/paleta Madrid; no convertirlo en visor GIS ni añadir texturas fotorrealistas.

- **No push, no deploy, no merges a feat/madrid.** Solo commits locales pequeños en feat/paridad. El propietario publica tras revisar.
- Solo geometría con fuente OSM/Catastro/IDEAM/i3s; aproximaciones low-poly y dimensiones ausentes se documentan. Nada de poblar calles/árboles al azar.
- Presupuesto **12 MiB de módulos de datos / 12 teselas**; no equivale a VRAM ni memoria JS. URLs de teselas `?v=<md5>`. No subirlo sin comparación medida.
- Suite verde antes de cierre; ampliar aserciones, no debilitarlas. Cache/fuentes pesadas en /tmp, limpiar cuando ya no hagan falta.
- No servicios de pago. `~/.nan_api_key` solo está autorizado para QC visual DeepSeek con imagen base64, deepseek-v4-flash, temperature 0; nunca imprimirla/copiarla. **No se ha usado** en esta sesión.
- Propietario autoriza navegador propio, GPU local, WebGPU y Blender para QC. No implica cambiar backend sin evidencia. Blender no estaba en PATH.
- El propietario pidió terminar la sesión y dejar este handoff. El objetivo se pausa al cerrar, no está logrado. Reanudarlo cuando el propietario lo solicite.

## Diferencia respecto a la misión inicial

La misión mencionaba feat/paridad con 19/85 teselas y 176 tests. Este checkout partía de **f40e310 en wip/madrid-experience**, sin feat/paridad local/remota ni madrid-facades.js. Se creó feat/paridad desde esa base, sin merges. Hay **12 entradas ready incl. semilla (11 periféricas) / 85**, y ahora **170 tests**. No se ha recuperado la otra línea; no afirmar que sus datos/validaciones existen aquí. Origin/feat/madrid y la web publicada difieren de este árbol. Se inspeccionaron remotos sin publicar nada.

## Hecho y commits

| Commit | Resultado |
|---|---|
| 6021714 | Auditoría web NYC/TinyWarsaw/despliegue y contadores de atributos CPU/compilaciones en harness |
| d3bece1 | Revoco/caliza sin juntas de ladrillo; paleta roja conserva ladrillo. Material compartido centro/teselas |
| 88b96e7 | Cubiertas existentes de semilla persistentes por celdas: desaparece círculo de detalle de 560 m en maqueta |
| 885344a | 10831 árboles con punto OSM real; streetFeatures con nodos originales de vías/señales y permisos/niveles |
| 6747522 | No crear pools de aceras rectangulares con capacidad cero; gate de buffers vacíos y adapterInfo WebGPU |
| 5462959 | Ensamblador de grafo residente por IDs OSM y opciones de preparación de carriles fuera de semilla |
| 365293e | Puente worker↔main: worker de red/carriles, datos planos indexados, rehidratación de consultas/curvas, señales por ID y lookups de bloque residentes |
| 7233bbc | Intercambio de red en caliente: setNetwork en tráfico y peatones, remapeo por posición+rumbo, retirada de agentes sin carril, servicio residente conectado a main y streaming |
| ad3defc | Pintura de calzada regenerable que sigue la red residente (malla única adoptada, geometría sustituida, material reutilizado) |
| 6cf2c01 | Tiempos por fase del swap en roadStats, prueba de los campos y prioridad de huecos peatonales retirados |
| 65322f3 | Fachada única con ventanas para landmarks genéricos (tinte/altura por UV, batching intacto) y fuentes como pavimento plano (fin del cubo de Cibeles) |

Capturas y mediciones: `docs/validation/2026-10-29-{revoco,roofs,streets,empty-storage,resident-graph}/`; baseline en `tools/madrid/measurements/`. Árboles: figuras low-poly ilustrativas; si faltan height/diameter_crown usan símbolo de 7 m / diámetro 4,4 m, posiciones de fuente a 1 cm. No son volúmenes ni especies medidos.

## B2 hecho: red residente en worker y agentes migrados

**La app ya circula sobre el grafo residente (OSM, semilla+teselas montadas).** Arquitectura final:

- `js/madrid-road-worker.js` + `js/madrid-road-preparer.js`: un Module Worker reutilizado ensambla el grafo residente y los carriles con `buildRoadNetwork(..., { roadGraph, sourceOnly: true, coverage })`. El servicio versiona/debouncia peticiones y descarta respuestas obsoletas.
- El grafo vivo es cíclico; structured clone desbordaba la pila. `road-network.js` expone `encodeRoadNetwork`/`decodeRoadNetwork` (datos planos indexados) y `hydrateRoadNetwork` reconstruye adyacencia, brazos, movimientos y curvas en main. `createGroundQueries` es la fábrica compartida de walkable/onSidewalk/isRoadClear.
- `js/madrid-road-network.js`: snapshot = vías (solo tags de circulación) + cobertura; lookup de bloques de teselas combinado con `seedBlockAt`; el worker NO recibe bordillos (ver hallazgo).
- `js/traffic.js`/`js/pedestrian-system.js`: `setNetwork(next, blockAt)` reinicializa contadores, rehace rutas peatonales y remapea por posición+rumbo (`js/madrid-road-matching.js`); los agentes sin carril equivalente se retiran y reaparecen. Nunca se reconstruyen poblaciones/mallas.
- `js/main.js`: servicio creado tras el streamer, refresco en `onStatus`, red aplicada al tráfico; `window.__madrid.roadStats` y `roadPaintStats` para QA.
- `js/road-paint.js` + main: las marcas siguen a la red viva (`createRoadPaint` adopta la malla de arranque y cambia solo la geometría; un material, sin recompilar; geometría anterior liberada; un solo grupo). El payload del worker trae `paintEdges: []`, así que se pintan las aristas de routing y se reconstruye la bandera de curva desde los brazos (87% de acuerdo con el builder).
- `roadStats.timings`: `snapshotMs`, `workerMs`, `applyMs` y reparto `queriesMs/decodeMs/blockLookupMs`, medidos en el mismo swap.

Validación (detalle y JSON en `docs/validation/2026-10-29-b2/`): suite **180/180**. Recorrido de teletransporte seed→k1j-1→k0j-1→k2j-1→seed con **200 coches y 171 peatones colocados**, `staleCars=stalePeds=0` en todos los pasos, todos los nodos vivos alcanzables desde Sol (saltos finitos 27–70) y 0 nodos dentro del núcleo de las 6 teselas descargadas; aristas 3431→2154 al descargar. `badS=0`, `laneOverhang=0`.

**Hallazgo importante:** la red heredada de la semilla ya estaba colapsada antes de B2 (6 nodos/6 aristas en el arranque; reproducido en worktree de `2e71da0` limpio). Los rectángulos de manzana de Madrid no son aceras y bloquean casi todos los carriles. El intercambio a la red residente es lo que hace que haya coches; queda como riesgo la caída a la red heredada si el worker falla. Las marcas de calzada ya se regeneran con el grafo residente (commit `ad3defc`).

Coste medido (CPU, software GL): con 5 teselas residentes `graphNodes 3526, graphSignals 686, routingNodes 1857, routingEdges 2884, assembledMs 18-41, layoutMs 92-310`. **Swap**: worker 162 ms ida y vuelta, main 4,2 ms (suelo 1,9 + decode 1,5 + bloques 0,8). **Pintura**: 14-40 ms y 24-42k vértices por swap, 1 malla; en Gran Vía se ven línea doble amarilla, carriles discontinuos y pasos de cebra alineados con la circulación (`paint-granvia.jpg`). Benchmark 12 teselas: 2559 nodos/3992 aristas. Es coste de preparación, **no FPS**. Script: `node tools/madrid/benchmark-road-graph.mjs` o lista de IDs.

## Lo próximo: calle con fuente, comparación visual y LOD

1. **B2 restante / calle**: veredicto visual con navegador real (GPU del propietario): paseo continuo seed→k3j0/k3j1 sin teletransporte, semáforos OSM visibles y sincronizados, aparcados/mobiliario con fuente, cruces protegidos durante descarga. Pintura ya sigue a la red; falta reenviar `paintEdges` por el worker (56% de cobertura física) y valorar moverla a worker (14-40 ms sincrónicos). Peatones: solo ~107 colocados a los 10 s del swap, densidad abierta.
2. **A**: veredicto por tres manzanas con cámaras iguales; patios (incluidos los 17 de k3j0 del handoff anterior), cubiertas y siluetas de monumentos. No confundir paseo de Sol con todo el centro. Hecho ya: fachada con ventanas para cuerpos de landmark genéricos y Fuente de Cibeles plana (`65322f3`, capturas `landmarks-cibeles.jpg`/`landmarks-linares.jpg`); quedan patios y el veredicto con GPU real.
3. **C**: inventario árboles/señales OSM ya empaquetado; falta instanciado por tesela, densidad y memoria antes/después.
4. **E1**: LOD geométrico centro/móvil; medir buffers/draws/compilación y FPS móvil físico. `?detail=geometry`/`?detail=distance` siguen optativos.
5. **D**: reconciliar la línea de 19 teselas y ampliar cobertura con fuentes; ojo a patios y presupuesto 12 MiB/12 teselas.
6. **Residuos visuales**: taxis amarillos/liveries NYC, monotonía de fachadas, plazas vacías; terreno/dosel TinyWarsaw no intentados.
7. **Comparación amplia con TinyWarsaw** en navegador (calle y aéreo), no solo bundle.

Entorno de esta sesión: sin `/dev/dri` dentro del sandbox → WebGL2 llvmpipe/software; las capturas de calle son a 1–3 FPS y las mediciones de FPS NO representan Iris Xe. Ver `docs/validation/2026-10-29-b2/README.md`.

## Pruebas y navegador

Web estática, sin package.json/build:

```sh
node --test tests/*.test.cjs
node --check tools/madrid/measure.mjs
git diff --check
python3 -m http.server 8080 --bind 127.0.0.1
```

Última suite verificada: **179/179**. Nuevas pruebas cubren propiedad/procedencia de árboles y tramos, continuidad de nodos, accesos/sentidos/niveles, cruces geométricos que NO se unen, bucles, preparación fuera de semilla, persistencia de cubiertas, encoding plano worker↔main, curvas rehidratadas, consultas de suelo, lookup de bloques residentes y snapshot del servicio. `tests/madrid-road-network.test.cjs` (9) cubre el puente y el servicio. No prueban agentes con navegador real ni paridad final.

QA visual/circulación de B2 (levantan su servidor efímero; rutas de esta máquina):

```sh
PLAYWRIGHT_MODULE=/home/germanpadua/.npm/_npx/ad9a3fdbcad992c6/node_modules/playwright-core/index.mjs CHROME_PATH=/home/germanpadua/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome node tools/madrid/check-circulation.mjs --timeout 240000
PLAYWRIGHT_MODULE=... CHROME_PATH=... node tools/madrid/debug-boot.mjs --timeout 1 --after 7000
PLAYWRIGHT_MODULE=... CHROME_PATH=... node tools/madrid/inspect-scene.mjs --place sol --grid 3
```

`check-circulation.mjs` escribe `docs/validation/2026-10-29-b2/{circulation.json,*.jpg}`. `inspect-scene.mjs` explica qué objetos/malla/material hay en pantalla (útil para QA de defectos visuales). \`debug-boot.mjs\` da un diagnóstico rápido de arranque sin esperar minutos.

Rutas de esta máquina, comprobar antes de reutilizar:

```sh
PLAYWRIGHT_MODULE=/home/germanpadua/.npm/_npx/ad9a3fdbcad992c6/node_modules/playwright-core/index.mjs CHROME_PATH=/home/germanpadua/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome HARDWARE_GPU=1 GL_PROFILE=1 node tools/madrid/measure.mjs --tiles k3j0,k3j1 --check-street-lifecycle
```

El harness levanta su servidor efímero. `--check-street-lifecycle` retira y recarga una tesela y exige la misma población vegetal: k3j0 volvió con 147 árboles. `--places sol,cibeles,alcala` son teletransportes, NO recorridos. VIEWS_DIR/SCREENSHOT guardan vistas; --aerial/--zoom controlan maqueta. `/tmp/madrid-explore.mjs` contiene el paseo con teclado (~35 m), maqueta y viewport móvil usado; es temporal y depende de rutas locales. Reproducir en navegador si desaparece. No asumir que servidor 8080 o browser de esta sesión siguen activos: comprobar/levantar propios.

### GPU: no repetir una conclusión equivocada

WebGL2 en la sesión de B2 **NO pudo usar Iris Xe**: dentro del sandbox no existe `/dev/dri` y Chromium cae a **llvmpipe (Mesa 26.0.8, software)**; WebGPU obtiene **SwiftShader/isFallbackAdapter=true**. La sesión anterior (handoff 5462959) sí midió Iris Xe vía WebGL2; esas cifras (18,5 s arranque, 711 draws, 4,29 M triángulos, ~36,5 FPS de muestra) siguen siendo la referencia desktop y no se han reproducido aquí. No atribuir a B2 un cambio de FPS medido sobre software.

Tras arreglo de aceras: cero GPUValidationError, pero solo 4 frames observados y pausas de 11–23 s en software; el gate completo WebGPU sigue fallando. Mantener WebGL2 predeterminado; probar WebGPU hardware en navegador físico aparte. No ocultar validaciones ni llamar a esto soporte WebGPU completo.

`geometryStorage.attributeBytes` mide payload de arrays únicos de escena (incl. oculta), no VRAM/heap total. GL_PROFILE cuenta llamadas/tiempo CPU desde navegación, no tiempo de ejecución GPU. Escenarios distintos tienen conjuntos residentes distintos: no atribuir mejoras a un draw count inferior sin cámaras/control de caché equivalentes.

## Fuentes y presupuestos

Overpass devolvió 406/timeouts. Se recuperó OSM desde Geofabrik:

- `/tmp/madrid-paridad.osm.pbf`, ~82 MB. MD5 `c1dfa14ee00cca5710549dadb49b4e5e` comprobado contra proveedor.
- SHA256 `d262f1c908907f596b4d02c2064014482e1b2ffced0f2b2886ab4ef89ec06471` en manifiesto/streetFeaturesSource.
- `/tmp/madrid-osm-features.json`, ~17 MB: 27733 árboles, 3194 señales, 43797 vías en bbox consultada. Solo las 12 entradas ready se empaquetan.
- pyosmium 4.3.2 instalado solo en `/tmp/madrid-osmium`. Python: `/home/germanpadua/.local/share/uv/python/cpython-3.13.15-linux-x86_64-gnu/bin/python` con `PYTHONPATH=/tmp/madrid-osmium`.

Reproducción (latest cambiará; verificar hash para igualdad exacta):

```sh
curl -fL -o /tmp/madrid-paridad.osm.pbf https://download.geofabrik.de/europe/spain/madrid-latest.osm.pbf
PYTHONPATH=/tmp/madrid-osmium /home/germanpadua/.local/share/uv/python/cpython-3.13.15-linux-x86_64-gnu/bin/python tools/madrid/extract-osm-features.py /tmp/madrid-paridad.osm.pbf /tmp/madrid-osm-features.json --bbox=-3.75,40.39,-3.65,40.46
node tools/madrid/pack-street-features.mjs /tmp/madrid-osm-features.json
```

El empaquetador es idempotente, actualiza MD5/bytes y comprueba presupuesto antes de escribir. Al regenerar teselas con build.mjs hay que repetirlo. No subir PBF/fuentes crudas al repo. Se conservan en /tmp para B2, limpiar al terminar.

Total ready + blocks: **12089352 B (11,53 MiB)**. Una prueba heredada exige que TODAS las entradas ready quepan en 12 MiB: será una restricción al ampliar a 85. Resolver diseño de formato/presupuesto y demostrar política residente, no borrar/debilitar la prueba para generar más celdas. Runtime streaming y este gate no son la misma magnitud.

Fuentes IDEAM/Catastro pesadas de reconstrucción de edificios aún no están disponibles en tools/data/madrid. Recuperar PBF no resuelve alturas/patios de las 73 entradas no-ready de ESTE checkout. No reconstruir con alturas inventadas.

## Pendiente antes de declarar compartible

- B2: red residente conectada y validada por datos (agentes fuera de semilla, 0 agentes obsoletos, continuidad seed↔teselas, descarga retira rutas). Falta veredicto visual real con GPU del propietario, semáforos visibles/sincronizados, aparcados/mobiliario con datos y `buildRoadPaint` sobre el grafo residente.
- A: veredicto por tres manzanas con cámaras iguales; patios (incluidos los 17 de k3j0 del handoff anterior), cubiertas y siluetas de monumentos. No confundir paseo de Sol con todo el centro.
- E: LOD geométrico del centro y niveles regionales/far; medir buffers/draws/compilación y FPS móvil físico. Experimentos ?detail=geometry y ?detail=distance siguen optativos, no activar por una muestra.
- D: reconciliar la otra línea de 19 teselas y ampliar cobertura con fuentes; evitar regresiones de patios y presupuesto.
- Otros residuos visuales: taxi amarillo/liveries NYC, monotonía de fachadas, plazas vacías; terreno/dosel de TinyWarsaw aún no intentados aquí.
- Comparación visual amplia con TinyWarsaw en navegador, rutas de calle y vista aérea; no solo leer bundle. Investigación y diferencias ya documentadas en MADRID-PARIDAD.

Checklist propietario: rama local en http://localhost:8080/?debug=1; Sol/Preciados (revoco claro y ladrillo rojo), maqueta (tejados sin círculo de 560 m), Retiro/Cibeles (árboles), k3j0 (patios, recarga), móvil real (HUD/controles/pausas). La web publicada NO contiene estos commits y no valida este trabajo.
