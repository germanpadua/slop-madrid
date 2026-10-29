# Plan de paridad — 2026-10-29

Objetivo abierto: acercar Madrid al acabado de TinyWarsaw, manteniendo datos oficiales, flat shading y simulación heredada de NYC. No push/deploy/merge. Rama de trabajo local feat/paridad, base f40e310. Las diferencias entre checkout y misión están en MADRID-PARIDAD.md.

| Bloque / orden | Estado | Criterio de cierre |
|---|---|---|
| 0. Investigación directa | Hecho con límites | NYC y módulos TinyWarsaw descargados, despliegue contrastado; faltan recorridos visuales de referentes |
| E0. Instrumentación | Hecho al validar harness | Contar compilaciones desde navegación y bytes de atributos únicos de escena; JSON reproducible |
| A. Fachadas y patios | Parcial: A0/A1 hechos; revisión amplia pendiente | Falta WIP referido madrid-facades.js; revisar alternativa local y patios k3j0, 3 manzanas con cámaras idénticas y veredicto individual |
| B. Vida fuera de semilla | B0/B1 hechos; B2 worker/agentes pendiente | Altas/bajas grafo y agentes, pruebas borde/descarga, paseo continuo sin teletransporte |
| C. Calle con fuente | C0 árboles hecho; señales/mobiliario pendientes | Inventario árboles/señales OSM, instanciado por tesela, densidad y memoria antes/después |
| E1. LOD centro/móvil | Pendiente | Conservar patios/siluetas, bajar draws/tris, repetir misma cámara; FPS real del propietario |
| D. Cobertura | OSM recuperado; alturas/base divergente pendientes | Reconciliar 19/85 frente a 12 ready locales y recuperar fuentes autorizadas antes de generar las restantes |

Orden: primero diagnóstico visual y contadores para evitar añadir detalle a ciegas; después agentes y detalle de calle para vida; después LOD del centro antes de multiplicar superficie. TinyWarsaw sugiere también terreno adaptativo, geometría precalculada, niveles regionales y revelado temprano: todavía no implementados aquí. No subir presupuesto sin medición.

## E0 — mediciones y reproducción

Comando desde el repositorio real (subcarpeta slop-madrid del workspace):

```sh
PLAYWRIGHT_MODULE=/home/germanpadua/.npm/_npx/ad9a3fdbcad992c6/node_modules/playwright-core/index.mjs CHROME_PATH=/home/germanpadua/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome HARDWARE_GPU=1 GL_PROFILE=1 node tools/madrid/measure.mjs --boot-only
```

Referencia inicial: passed=true, WebGL2/Mesa 26.0.8, arranque 18508 ms, 711 draws, 4289107 triángulos; muestra de ~3 s: 36,54 FPS, p95 intervalo 33,4 ms, máximo 150 ms, render máximo 35,8 ms. Es una muestra desktop, no garantía ni benchmark móvil. No hay errores gráficos. El conjunto residente puede cambiar mientras se mide: snapshot inicial 1447308 bytes, posterior streaming 2186040 bytes. No confundir con buffers.

Presupuesto sin cambios: 12582912 bytes de módulos, máximo 12 teselas; excluye buffers, texturas y overhead JS. Geometría medida por el nuevo campo `geometryStorage.attributeBytes`: suma payload de arrays únicos de atributos/índices/morph/instancias de toda escena, también oculta. No es VRAM ni memoria total del proceso. `glTotalsSinceNavigation`: llamadas y tiempo CPU de compilación/link/upload/dibujo desde navegación; sin GL_PROFILE es null; el perfil anterior solo recogía llamadas lentas >2 ms durante ruta. No mide duración GPU.

Bytes/entrada ready manifest: fase2 738732; k0j-1 287174; k0j3 450984; k1j-1 340592; k2j-1 495213; k2j4 424999; k3j-1 229533; k3j0 202659; k3j1 121670; k4j0 370804; k4j1 399280; k4j2 693314. No son los tamaños de las 19 teselas de la otra línea.

Rollback E0: revertir instrumentación de tools/madrid/measure.mjs y sus informes; no cambia app ni fuentes. No se han modificado ni debilitado aserciones.

## Checklist del propietario por bloque

- [ ] Investigación: abrir https://tinywarsaw.app/preview/ y https://mrdoob.github.io/slop-newyork/; comparar calle y vista aérea, especialmente continuidad de detalle.
- [ ] A: servir `python3 -m http.server 8080`, abrir http://localhost:8080/?debug=1; Sol/Cibeles y maqueta k3j0. Ver balcones, zócalos y patios sin tapas; acercarse/alejarse. Pendiente capturas por manzana.
- [ ] B: en esa URL, paseo continuo desde semilla a k3j0/k3j1: deberían circular coches y cruzar peatones sin cortes ni agentes sobre edificios. Función aún pendiente.
- [ ] C: árboles/señales alineados con fuente; ninguna duplicación al volver a tesela. Pendiente.
- [ ] E: misma ruta en móvil físico; informar GPU/dispositivo, FPS y pausas. No se ha elevado presupuesto ni activado proxy experimental.
- [ ] D: mapa continuo de almendra sin huecos fuera de cobertura. Pendiente datos.
- [ ] Publicado https://germanpadua.github.io/slop-madrid/ no contiene este trabajo; inspeccionarlo no valida la rama local.


## Cierre de esta sesión

E0 validado: segundo arranque passed=true, 17244 ms; 72583390 bytes de atributos CPU (69,22 MiB), 4808 geometrías y 10267 arrays únicos. 199 compileShader, 109 linkProgram, 5484 bufferData. Consulta getProgramParameter: 3328,1 ms acumulados, máximo 931,9 ms; bufferData máximo 294 ms. Estos tiempos no son GPU timers. 711 draws, 4288613 triángulos; pequeñas diferencias de triángulos por simulación viva. No se atribuye la diferencia 18,5→17,2 s a mejora de rendimiento: solo cambió la instrumentación, son muestras únicas.

Evidencia persistente: tools/madrid/measurements/2026-10-29-{baseline,instrumented}.json y 2026-10-29-sol.png. La captura corresponde al primer arranque. No se alteró el render entre ambos. Suite final 160/160, cero fallos; node --check y git diff --check correctos. No se ejecutaron A/B/C/D/E1. El objetivo general permanece pendiente.

## A0 — distinguir revoco y ladrillo (hecho)

Exploración Chromium real con teclado: paseo de ~35 m desde Sol, después maqueta y viewport 390×844. Sin pageerrors. Defecto observado: la retícula de ladrillo NYC se aplicaba también a caliza/revoco; ahora la opción uniforme brickwork conserva juntas en la paleta roja y las elimina de los otros tres acabados. Ambos caminos ya comparten estas opciones. Paletas ilustrativas, no clasificación material por parcela.

Evidencia en docs/validation/2026-10-29-revoco/: before/after, móvil, paseo y medición. Veredicto local Sol/Preciados: superficies claras más legibles; ladrillo conserva su textura; pendiente revisión por manzana y patios. 160/160 tests, detector sin hallazgos, harness passed=true sin errores gráficos. Atributos idénticos: 72583390 bytes, 711 draws. Arranque 20490 ms en esta muestra; no afirmar mejora de FPS. Rollback: brickwork en tsl-materials y opciones Madrid.

Checklist A0: http://localhost:8080/?debug=1, caminar desde Sol hacia Preciados; las fachadas claras deben ser lisas y la roja conservar juntas. Confirmar lo mismo en móvil. La maqueta revela un defecto siguiente: tejados del centro limitados al radio de detalle 560 m.

Adquisición de árboles OSM: endpoint principal devuelve 406; dos espejos agotaron timeout sin datos. No se añadieron árboles inventados. Reintentar con extracto PBF o endpoint disponible antes de ampliar vegetación.

## A1 — continuidad de tejados de semilla (hecho, revisión amplia pendiente)

La maqueta demostraba un radio circular de tejados de solo 560 m: la cubierta compartía pool con detalles cercanos. Ahora las decisiones de cubierta ya existentes se conservan en lotes estáticos de 512 m, con buffers del tamaño exacto y frustum culling. No se generan cubiertas nuevas ni se alteran alturas/huellas. La regla de tejado sigue siendo una aproximación ilustrativa heredada, no una medición municipal de cada faldón. Corregido también límite por tipo del pool heredado para evitar sobrepasar su capacidad individual.

Comparación docs/validation/2026-10-29-roofs/: desaparece el límite circular en maqueta, patio visible y paleta terracota continua. Harness passed=true, cero errores gráficos/pageerrors. Atributos CPU 72583390→73075186 bytes (+491796; ~0,47 MiB); draws 711→740; triángulos de muestra 4289107→4310035. No se eleva presupuesto de datos. Muestras concurrentes de navegador: NO usar tiempos/FPS para atribuir aceleración. Tests nuevos: 4000 cubiertas sin pérdida/duplicación, separación hip/ring y conservación de transformaciones. Suite 162/162 al resolver precarga del nuevo módulo. Rollback: collectRoofBatches, lotes estáticos y exclusión de Madrid del pool dinámico.

Checklist A1: http://localhost:8080/?debug=1, abrir maqueta y alejarse de Sol: tejados terracota deben continuar más allá del antiguo círculo cercano. Revisar móvil y k3j0, especialmente cubiertas de patios y bordes. No se declara aún A completo por esta vista general.

## C0/B0 — recuperar fuente OSM y vegetación residente (hecho)

Overpass dejó de ser bloqueo: descargado extracto Geofabrik Madrid de ~81,5 MiB en /tmp, checksum MD5 c1dfa14ee00cca5710549dadb49b4e5e coincidente con proveedor. SHA256 y bbox consultada están dentro de streetFeaturesSource en el manifiesto y de cada streetFeatures. Se conserva nodo OSM original por árbol/señal y por vértice de vía, más highway/access/oneway/layer/bridge/tunnel y otras etiquetas útiles. Ningún cruce se ha inferido por proximidad. Esto prepara B, pero aún no conecta el nuevo grafo a tráfico/peatones.

12 entradas ready: 10831 árboles, 6706 en semilla; fuentes completas para bbox de todas ellas. Árboles instanciados en posición OSM exacta (redondeo 1 cm), sin plantación procedural adicional. Copas/troncos low-poly ilustrativos: height y diameter_crown cuando existen y son plausibles; en ausencia, símbolo de 7 m de alto/4,4 m de diámetro. No se afirma especie o volumen municipal medido. Dos draws por grupo con datos, frustum bounds y retirada de geometría/instancias al descargar tesela. Materiales compartidos.

Empaquetado conserva contrato JSON TILE y actualiza bytes/MD5 por módulo; URLs versionadas del streamer existentes. Primera versión excedía el presupuesto y fallaba cinco pruebas: se redujeron etiquetas a las necesarias y se restauró el contrato, sin cambiar los límites de las pruebas. Total ready + blocks = 12089352 B (11,53 MiB), bajo 12 MiB. El empaquetador comprueba ese límite antes de escribir y es idempotente (checksum del manifiesto idéntico tras segunda ejecución).

Reproducción, con pyosmium instalado en el Python elegido:

```sh
curl -fL -o /tmp/madrid-paridad.osm.pbf https://download.geofabrik.de/europe/spain/madrid-latest.osm.pbf
python tools/madrid/extract-osm-features.py /tmp/madrid-paridad.osm.pbf /tmp/madrid-osm-features.json --bbox=-3.75,40.39,-3.65,40.46
node tools/madrid/pack-street-features.mjs /tmp/madrid-osm-features.json
```

La URL latest cambia: comparar SHA256 con manifiesto para reproducir exactamente este conjunto. En esta sesión pyosmium 4.3.2 se instaló solo en /tmp/madrid-osmium con uv, usando Python 3.13.15. PBF/fuentes crudas se mantienen en /tmp para continuar B, no se añaden al repositorio. Tras reconstruir teselas con build.mjs hay que repetir pack-street-features para retener estos datos.

Validación: suite ampliada 164/164; pruebas de identidad/procedencia/propiedad única de árboles y tramos y coordenadas de nodos iguales entre teselas. Harness `--tiles k3j0,k3j1 --check-street-lifecycle`: passed=true, cero errores gráficos; descarga k3j0 retira grupo y datos, recarga conserva exactamente 147 árboles. Snapshot de esa ruta: 79663096 B de atributos CPU, 685 draws y 4498737 tris; streaming 6613374 B. Cámara y conjunto distintos del boot: no atribuir reducción de draws respecto a A1 a mejora de rendimiento. Capturas aéreas y viewport móvil en docs/validation/2026-10-29-streets/. Paseo con teclado sin pageerrors. Falta validación de móvil físico y LOD de copas.

Rollback C0/B0: revertir datos enriquecidos/manifiesto y renderer de árboles junto con empaquetador; cubiertas y revoco son independientes.

Checklist C0: http://localhost:8080/?debug=1, maqueta desde Sol: copas en plazas/parques y alineaciones reales. Pasear por Cibeles/Retiro y revisar separación respecto a fachadas. Al salir/volver a k3j0 debe haber la misma población vegetal sin duplicaciones. Señales y vías están recuperadas como datos; todavía no se dibujan las señales ni se simula tráfico nuevo sobre ellas.

Siguiente acción: ensamblar grafo residente por IDs OSM y permisos de circulación, conectar al motor conservando población y validando bordes/retirada. El propietario autoriza GPU local, WebGPU y Blender para comprobaciones. Prueba WebGPU separada en curso; WebGL2 sigue predeterminado hasta tener evidencia de estabilidad. Blender no aparece en PATH; no bloquea estas verificaciones de navegador.

WebGPU comprobado en Chromium local (posteriormente identificado como adaptador software): backend real WebGPU, arranque 32623 ms, sin pérdida de dispositivo, pero passed=false por GPUValidationError de binding de buffers de tamaño cero. Informe webgpu.json en evidencia C0/B0. WebGL2 permanece predeterminado. Siguiente diagnóstico: meshes instanciados vacíos enviados a compile/render, sin ocultar errores ni declarar paridad de backend.

## E2 — pools vacíos y adaptador WebGPU (corrección hecha, WebGPU hardware sin verificar)

Diagnóstico de escena localizó dos InstancedMesh de capacidad cero bajo ManhattanCityGrid. El centro usa aceras poligonales, por lo que rectSlabs es vacío; ahora no se crean/montan esos pools rectangulares. No se silencian validaciones. Harness amplía el gate: emptyInstanceStorage debe estar vacío.

WebGL2 sobre Intel Iris Xe (ANGLE/Mesa 26.0.8, confirmado por glRenderer) pasa con emptyInstanceStorage=[], cero errores gráficos y arranque de muestra 17247 ms. WebGPU ya no emite GPUValidationError, pero el harness sigue fallando por cero frames en su ventana corta. Observación más larga obtiene solo 4 frames, con pausas de 22,7 s y 11 s. La consulta directa revela adaptador Google SwiftShader isFallbackAdapter=true con ANGLE GL; solicitando ANGLE Vulkan no obtiene adaptador. Por tanto, las pruebas WebGPU anteriores eran software, NO mediciones de la GPU física. Enumerar dispositivos en SystemInfo no identifica el adaptador WebGPU elegido. El harness registra ahora GPUDevice.adapterInfo cuando existe. No cambiar backend predeterminado ni inferir rendimiento WebGPU de la Iris a partir de estos datos.

Evidencia en docs/validation/2026-10-29-empty-storage/: escena anterior, ambas mediciones, consulta de adaptadores y secuencia de frames. Rollback E2: guard de rectSlabs en city-grid y gate/telemetría del harness. Suite total actual 170/170 (incluye seis pruebas nuevas del ensamblador residente en preparación).

Checklist E2: http://localhost:8080/?debug=1 sigue mostrando las mismas aceras. http://localhost:8080/?debug=1&webgpu=1 permite probar el backend en el navegador físico del propietario; verificar adaptador real y fluidez antes de recomendarlo. No se declara compartible por esta corrección.

## B1 — ensamblador de topología residente (hecho; integración con agentes pendiente)

Nuevo buildResidentRoadGraph combina streetFeatures residentes por IDs OSM, sin cruces inferidos por coordenadas. Simplifica solo nodos de forma de la misma vía, conserva señales/cruces y usa dos nodos originales para bucles cerrados (evita self-links descartados por el constructor de carriles). Política de circulación: respeta acceso de motor_vehicle/vehicle/access, oneway y roundabout; excluye peatones y vías con bridge/tunnel/layer sin perfil vertical resuelto. Anchuras sin etiqueta conservan aproximación de clase/carriles ya usada por el pipeline, no son medición topográfica.

buildRoadNetwork acepta roadGraph/coverage/sourceOnly para preparar esas calles fuera de límites de semilla sin insertar rejilla heredada; el comportamiento predeterminado sigue intacto. Todavía NO se llama a esta opción desde la app ni cambian las rutas de los agentes. No declarar B terminado.

Seis pruebas nuevas: continuidad entre celdas y orden de carga, retirada de aristas al descargar, cruces geométricos que no deben conectarse, permisos/sentidos/niveles, conservación de señales y bucles, preparación de carriles fuera de semilla y rechazo de terreno no residente. Suite 170/170. `node tools/madrid/benchmark-road-graph.mjs`: 5437 nodos/6772 enlaces de fuente, 1039 señales, 2559 nodos/3992 aristas de circulación; 128 ms ensamblado + 767 ms preparación en esta muestra. Benchmark sin obstáculos/aceras: coste mínimo orientativo, no FPS ni prueba de colisiones. Informe en docs/validation/2026-10-29-resident-graph/cpu.json. Esta latencia exige preparación fuera del hilo de interacción antes de conectar altas/bajas a la app.

Rollback B1: retirar ensamblador y opciones de buildRoadNetwork junto con sus pruebas/benchmark; C0 y visual no dependen todavía de él.

Checklist B1: no hay cambio visual de tráfico que aprobar aún; http://localhost:8080/?debug=1 conserva la simulación anterior. La siguiente integración debe demostrar coches/peatones fuera de semilla, continuidad al cargar, retirada segura al descargar y ausencia de rutas sobre edificios o vías excluidas. Mantener esa validación pendiente.


## Traspaso y pausa solicitados por el propietario

El propietario termina la sesión y solicita instrucciones para otros agentes. Se actualizan CODEX-HANDOFF.md y CONTINUE-PROMPT.md con el estado de feat/paridad, commits, fuentes temporales, comandos, restricciones y plan técnico B2. Último código: 5462959. No hay implementación de worker/migración comenzada ni cambios de código a medias. Objetivo general incompleto; pausa de sesión, no cierre por éxito. Reanudar desde B2. La documentación de bloques anteriores es cronológica: la tabla inicial y este handoff expresan el estado vigente.
