# Continuar paridad Madrid — traspaso 2026-10-29

## Arranque obligatorio

Repositorio real de esta sesión: `/home/germanpadua/proyectos/slop-madrid/slop-madrid` (subcarpeta del workspace). Verificar `pwd`, `git status --short`, `git branch --show-current`, `git log -8 --oneline` antes de editar. Rama **feat/paridad**. Último commit de implementación **5462959**; el commit que contiene este handoff es posterior. No quedan cambios de implementación a medio editar al escribirlo.

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

Capturas y mediciones: `docs/validation/2026-10-29-{revoco,roofs,streets,empty-storage,resident-graph}/`; baseline en `tools/madrid/measurements/`. Árboles: figuras low-poly ilustrativas; si faltan height/diameter_crown usan símbolo de 7 m / diámetro 4,4 m, posiciones de fuente a 1 cm. No son volúmenes ni especies medidos.

## Lo próximo: conectar tráfico y peatones (B2)

**B1 NO está conectado a la app. Los agentes todavía usan la red inicial.** El ensamblador y el constructor de carriles ya están probados, pero no hay worker de rutas ni API de migración de población implementados.

Puntos de integración:

- `js/madrid-resident-road-graph.js`: `buildResidentRoadGraph(featureSets)` devuelve nodes/links/names/osmNodeIds/signals en contrato del grafo. Usa IDs, nunca cruces por proximidad. Respeta acceso/sentidos/roundabout. Excluye bridge/tunnel/layer sin perfil vertical. Preserva señales y bucles cerrados con anclas de fuente.
- `js/road-network.js`: `buildRoadNetwork(sidewalks, obstacles, signals, { roadGraph, coverage, sourceOnly: true })`. El modo nuevo evita rejilla heredada y admite cobertura fuera de semilla. El modo por defecto sigue anterior.
- `tileWorld.residentStreetFeatures()` devuelve Map de fuente de semilla y teselas montadas. Se elimina al descargar. `tileWorld.ids()` solo periféricas. Cobertura real y metadata están en manifiesto/streamer.
- `js/main.js`: crea tráfico antes del streamer; `onStatus` del streamer solo refresca colisionadores y registra LOD. Hay que conectar actualización de grafo aquí, agrupando ráfagas y descartando resultados worker obsoletos.
- `js/traffic.js`: mantiene `const network` y `const {nodes,edges,connector,curvePoint}`; inicializa contadores de nodos y ocupación de aristas al construir. No existe setter. No reconstruir toda la población/mallas por cada tesela. Conservar coches sobre aristas equivalentes y retirar/reubicar solo rutas inválidas; manejar v.move/v.conn/v.commit, ocupación, touchedNodes/touchedEdges y caché nearEdges.
- `js/pedestrian-system.js`: `const pedRoutes = createPedestrianRoutes(network, blockAt)` y `blockAt` de city-config solo conoce bloques de semilla. Necesita bloques/aceras residentes y invalidación de tracks/caches al retirar geometría; no basta ampliar red de coches.

Arquitectura considerada, **todavía no ejecutada**:

1. Sacar consultas espaciales del inicio de buildRoadNetwork a una fábrica reutilizable (walkable/onSidewalk/isRoadClear/blocked). El worker puede devolver nodos/aristas cíclicos por structured clone, pero **no funciones**.
2. Separar/exportar fábrica de connector (actual cierre con Map de curvas, utiliza IDs de aristas) y curvePoint. Rehidratar funciones en main y reconstruir consultas de ocupación/cobertura; no reutilizar cache de curvas tras renumerar aristas.
3. Worker de preparación de red: ensamblar grafo + carriles fuera del hilo de animación, con versión de snapshot y descarte de resultados viejos. Verificar memoria: importar road-network en worker arrastra city-config y geodata de semilla; no asumir que no cuesta heap.
4. Migración estable de agentes/red, bloques residentes y rutas peatonales. No dejar referencias hacia nodos/aristas descargados. Durante descarga, desactivar inmediatamente rutas inválidas mientras llega snapshot nuevo.
5. Recorrido continuo desde semilla a periferia y ciclo descarga/recarga con agentes observados. Medir pausas/FPS con GPU real y revisar cruces/edificios.

Datos reales completos sin obstáculos/aceras: benchmark 5437 nodos/6772 enlaces de fuente, 1039 señales; 2559 nodos/3992 aristas de circulación. 128 ms ensamblado + 767 ms carriles en una muestra CPU. Es coste mínimo, **no FPS ni validación de colisiones**. No meter ~0,9 s síncronos en onStatus. Script: `node tools/madrid/benchmark-road-graph.mjs` o una lista de IDs como primer argumento.

## Pruebas y navegador

Web estática, sin package.json/build:

```sh
node --test tests/*.test.cjs
node --check tools/madrid/measure.mjs
git diff --check
python3 -m http.server 8080 --bind 127.0.0.1
```

Última suite verificada: **170/170**. Nuevas pruebas cubren propiedad/procedencia de árboles y tramos, continuidad de nodos, accesos/sentidos/niveles, cruces geométricos que NO se unen, bucles, preparación fuera de semilla y persistencia de cubiertas. No prueban todavía agentes en periferia ni paridad final.

Rutas de esta máquina, comprobar antes de reutilizar:

```sh
PLAYWRIGHT_MODULE=/home/germanpadua/.npm/_npx/ad9a3fdbcad992c6/node_modules/playwright-core/index.mjs CHROME_PATH=/home/germanpadua/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome HARDWARE_GPU=1 GL_PROFILE=1 node tools/madrid/measure.mjs --tiles k3j0,k3j1 --check-street-lifecycle
```

El harness levanta su servidor efímero. `--check-street-lifecycle` retira y recarga una tesela y exige la misma población vegetal: k3j0 volvió con 147 árboles. `--places sol,cibeles,alcala` son teletransportes, NO recorridos. VIEWS_DIR/SCREENSHOT guardan vistas; --aerial/--zoom controlan maqueta. `/tmp/madrid-explore.mjs` contiene el paseo con teclado (~35 m), maqueta y viewport móvil usado; es temporal y depende de rutas locales. Reproducir en navegador si desaparece. No asumir que servidor 8080 o browser de esta sesión siguen activos: comprobar/levantar propios.

### GPU: no repetir una conclusión equivocada

WebGL2 usa físicamente **Intel Iris Xe (RPL-P), ANGLE OpenGL ES/Mesa 26.0.8** según glRenderer. WebGPU con flags actuales obtiene **Google SwiftShader, isFallbackAdapter=true**; con ANGLE Vulkan no obtiene adaptador. **SystemInfo enumera GPUs, pero NO identifica el adaptador WebGPU seleccionado.** Las mediciones WebGPU de esta sesión NO representan rendimiento de la GPU física.

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

- B2 y calle: agentes fuera de semilla, semáforos visibles y sincronizados con fuente, aparcados/mobiliario con datos, continuidad en bordes.
- A: veredicto por tres manzanas con cámaras iguales; patios (incluidos los 17 de k3j0 del handoff anterior), cubiertas y siluetas de monumentos. No confundir paseo de Sol con todo el centro.
- E: LOD geométrico del centro y niveles regionales/far; medir buffers/draws/compilación y FPS móvil físico. Experimentos ?detail=geometry y ?detail=distance siguen optativos, no activar por una muestra.
- D: reconciliar la otra línea de 19 teselas y ampliar cobertura con fuentes; evitar regresiones de patios y presupuesto.
- Otros residuos visuales: taxi amarillo/liveries NYC, monotonía de fachadas, plazas vacías; terreno/dosel de TinyWarsaw aún no intentados aquí.
- Comparación visual amplia con TinyWarsaw en navegador, rutas de calle y vista aérea; no solo leer bundle. Investigación y diferencias ya documentadas en MADRID-PARIDAD.

Checklist propietario: rama local en http://localhost:8080/?debug=1; Sol/Preciados (revoco claro y ladrillo rojo), maqueta (tejados sin círculo de 560 m), Retiro/Cibeles (árboles), k3j0 (patios, recarga), móvil real (HUD/controles/pausas). La web publicada NO contiene estos commits y no valida este trabajo.
