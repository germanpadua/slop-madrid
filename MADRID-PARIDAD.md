# Paridad Madrid — auditoría directa, 2026-10-29

TinyWarsaw es el referente principal de acabado por preferencia explícita del propietario. NYC sigue siendo referencia de simulación y lenguaje flat shading. Esta auditoría no sustituye una comparación visual controlada de los tres navegadores.

## Fuentes y método

- [NYC código](https://github.com/mrdoob/slop-newyork): fetch directo de main a `upstream/main`, HEAD `e35c06c`; `git diff upstream/main --stat` (157 archivos, +20656/-15262) y lectura de main, audio, materiales y sistemas locales. El tamaño del diff incluye refactors upstream: no equivale a funcionalidad ausente.
- [TinyWarsaw motor](https://tinywarsaw.app/preview/engine/): HTML descargado directamente; cifras siguientes son publicadas por su autor, no mediciones nuestras. Preview y raíz descargados también. Bootstrap `assets/index-D3xD0Kdd.js` (4128 bytes), motor `main-D75wkAlf.js` (281435 bytes) y `buildings-Wg-OIW2D.js` (15331 bytes) inspeccionados. El motor contiene `spike2/cells/manifest.json`, lectura arrayBuffer, hash `?v=`, AbortSignal, far/index y modelo signal. La búsqueda pública GitHub `search/repositories?q=tinywarsaw` devuelve cero: no se ha localizado repositorio; no prueba que no exista.
- [Madrid publicada](https://germanpadua.github.io/slop-madrid/): index y js/main.js descargados. SHA256 index publicado `f3457ad68be9294add7d230319aaa19da7aad672f65fcbaa4d0890423ec91f75`; local `82a520c2d100d12dd25bc0da11dc614bd9873871f564b5219d1b7c5cc13bd14e`. Main publicado `80a6fc5071c9afdbf657f70be762927f525ce92b6172158633f4f42e36b0fc08`; local `df1d4a213625f7e6833ed2122c239dfd9fbb9964ab0fccd3a6d23b5e95727a9d`. No coincide con este checkout. No se ha atribuido un commit al despliegue comparando solo estos dos archivos.

## Diferencia de estado que condiciona la ejecución

El repositorio está en la subcarpeta `slop-madrid/` del workspace. Base disponible `f40e310`, rama inicial `wip/madrid-experience`; creada localmente `feat/paridad` desde esa base. No existe feat/paridad remoto según ls-remote. No se ha fusionado ni publicado nada. El remoto origin tiene feat/madrid en `f64e847` y wip/madrid-experience en `214520e` (no incorporado automáticamente).

El estado aportado por el propietario (19/85, 176 tests, madrid-facades.js) queda como evidencia de otra línea de trabajo, no se descarta. Aquí el manifest contiene 12 entradas ready incluida semilla, y la suite tiene 160 tests; no existe madrid-facades.js. Handoff local documenta fuentes pesadas ausentes y permisos de redistribución pendientes. No reconstruir 66 celdas sobre esta base como si se dispusiera de aquel pipeline completo.

## Comparación sistema por sistema

Costes orientativos en jornadas de implementación + validación, no compromisos; ampliación de datos depende de fuentes disponibles.

| Sistema | NYC auditado | TinyWarsaw auditado | Madrid local hoy | Hueco concreto y coste |
|---|---|---|---|---|
| Edificios y variedad | Huellas/alturas NYC; nuevas entradas y mayor cobertura de escaparates en commits de hoy | 141617 edificios, superficie/terreno GUGiK 2025 de 0,5 m; escaparates en shader observados | Huellas y patios, paleta Madrid, 4 fachadas compartidas; cubiertas de centro/teselas divergen | Revisar 3 manzanas con cámaras fijas, variar solo detalles ilustrativos documentados; 2–4 d |
| Terreno y vegetación | Árboles de datos NYC; hoy culling jerárquico por celdas | 2,14 M árboles desde datos de superficie/ortofotos; 36% en dosel cerrado; terreno adaptativo | Árboles disponibles en datos Madrid; sin cobertura equivalente de dosel/relieve demostrada | Auditar conteo puntos OSM por celda antes de añadir instancias; terreno oficial separado; 3–8 d |
| Tráfico | Grafo, prioridad, cruces, vehículos y colisiones; nuevas ruedas/materiales | Rides y vuelos publicados; modelo de semáforo en bundle. Tráfico autónomo no confirmado | createTrafficSystem se construye al arranque; addTile no actualiza ese sistema | Integrar altas/bajas de aristas, reubicar agentes y proteger cruces durante descarga; 4–7 d |
| Peatones | Aceras conectadas, cruces y conversación; hoy optimiza shaders/culling/IK inactivo | Densidad y comportamiento autónomo no determinados en esta inspección | Sistema heredado ligado a red inicial | Aceras OSM, continuidad al borde y evacuación al descargar; 3–5 d |
| Calle | Marcas, señales, luces, entradas; hoy chunk/culling de marcas | Modelo signal y edificios con planta comercial; densidad de coches/señales no medida | Detalles en semilla, vacíos visibles en Sol en captura local | Inventario con fuente, mobiliario instanciado por tesela; 2–4 d |
| Audio | Síntesis espacial, tráfico, impactos, conversación | No verificado | Síntesis heredada y adaptaciones locales; diferencias upstream en prioridades/eventos | Escuchar a pie y fuera de semilla; no importar NYC acústico sin selección; 1–2 d |
| Luz/clima | Presets de hora, sombras; reflexión skyline condicionada hoy por hora/región | Sol y niebla; crossfade lejano en haze; clima dinámico no confirmado | Golden/midday/twilight/midnight y luz monumentos | Comparar legibilidad nocturna y contraste; lluvia no acreditada como brecha; 1–2 d |
| Postproceso | Bloom, grading, SSR | WebGL preferido; WebGPU descartado por autor tras pruebas desktop/S23 | WebGL2 predeterminado; WebGPU experimental, bloom y grading | Mantener backend estable y medir coste; 1–2 d |
| HUD/mapa | Mapa, controles y navegación multimodo | Búsqueda/i18n en módulos, rides, altímetro y límite vuelo en notas | HUD/minimapa y controles táctiles; captura muestra taxi amarillo residual | Validar móvil real, unidades y estética local; 1–3 d |
| Streaming | Mundo original y culling de sistemas | 924 celdas de 600 m, 332,6 km²; cache por bytes, cancelación, hash; arranque ~5 MB independiente de extensión | 12 MiB módulos/12 teselas, worker, reservas, look-ahead; aquí 11 periféricas listas | Completar datos tras reconciliar checkout/fuentes; 2–5 d pipeline más adquisición |
| LOD y GPU | Culling por sistemas en evolución reciente | Overview y regiones precalculadas: móvil declarado 4,58 M→0,36 M tris, 761→12 draws, 309→23 MB GPU | Proxy lejano experimental; centro conserva detalle; 711 draws/4,29 M tris en muestra local | Proxy del centro y regiones con geometría fiel, sin texturas fotorrealistas; 4–8 d |
| Monumentos | Landmarks propios | ~60% triángulos iniciales; su LOD1 apenas simplificado, problema abierto | 10 según estado propietario, modelos/low poly y carga prioritaria | Simplificar conservando silueta y fuentes; no copiar coste excesivo del referente; 2–5 d |

## Evolución upstream que merece selección

29 de octubre: entradas procedurales (`26bb9fe`), escaparates (`633ecd0`, `dbaf5f9`), colisión poligonal (`28c0af7`), ruedas (`9cabaeb`), gating reflejos (`f097197`), marcas por chunks (`997185d`), peatones/IK (`1fe128d`), escaleras (`ab33d1b`, `00d95cb`), árboles (`e35c06c`). Priorizar culling/marcas/peatones; las escaleras exteriores NYC no encajan en Madrid. No cherry-pick masivo: actor-models/buildings difieren mucho.

## Validación visual y límites

Propietario: se conserva su validación previa de ausencia de monstruos/solapes y petición de más detalle; no se extrapola al checkout distinto. Prefiere TinyWarsaw. Pendiente: fachadas por manzana, patios corregidos, monumentos, continuidad de tráfico y móvil real.

Captura local `/tmp/paridad-baseline.png`: Sol desde taxi, fachadas legibles pero repetitivas, gran superficie de calle/plaza vacía y taxi amarillo heredado. No demuestra fidelidad de alturas ni valida todo Sol. No se ha aplicado cambio visual, por tanto no hay un antes/después de fachadas que declarar aprobado.

Medición reproducible y siguiente orden en PARIDAD-PLAN.md. Las notas de TinyWarsaw indican que sus cifras de teléfono son emulación sobre GPU desktop salvo indicación explícita: no compararlas como FPS de móvil real con este harness.

### Avance A0 posterior a auditoría

Paseo local automatizado con teclado (~35 m), maqueta y viewport móvil: cero pageerrors. Corregida apariencia de revoco/caliza, antes cubierta por retícula de ladrillo heredada. No altera fuentes ni geometría. Evidencia docs/validation/2026-10-29-revoco/. La continuidad de tejados en maqueta sigue pendiente: el centro los incluye en detalle de radio 560 m. Vegetación bloqueada de momento por 406/timeouts Overpass; no se ha inventado densidad.
