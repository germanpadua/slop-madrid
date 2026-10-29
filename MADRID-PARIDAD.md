# Paridad Madrid — auditoría y estado reanudable

Fecha de línea base: 2026-10-29. Rama de trabajo: `feat/paridad`. Ningún push, merge a main ni deploy autorizado.
Este informe es de código/datos; **no constituye aprobación visual**. El propietario valida el resultado con GPU.

## Evidencia anterior a cambios de producto

- Leído `MADRID.md` completo (594 líneas), manifiestos, generador, módulos de semilla y teselas, consumidores y contratos.
- `git log --all`: `upstream/main = main = 09361be`; `feat/madrid = 791f17c`; `feat/monumentos = dac8b4e`.
  Hay **seis** commits sobre Madrid, cuatro locales sobre `origin/feat/monumentos`, no cuatro sobre Madrid.
  Integrados mediante merge local desde una rama nueva nacida en `feat/madrid`.
- `git diff upstream/main...feat/madrid --stat`: 41 ficheros, +9365 / −1729. Lectura dirigida de city-config,
  city-grid, buildings, landmarks, road-network, nyc-map, main, cámaras y controllers; street-details, traffic,
  road-paint, trees, audio y materiales se conservan esencialmente de upstream.
- Suite inicial exacta: `node --test tests/*.test.cjs tests/*.test.mjs`: **137/137**, 66,29 s.
- Manifiesto inicial: **8/85 listas, 77 pendientes**, 15,20 km² de cores listos, 6.788.893 B de módulos
  (incluye semilla y manzanas). No confundir 85 km de cuadrícula envolvente con los 52,1 km² de almendra.
  La selección de celdas usa la **caja** del anillo M-30; varias celdas periféricas están fuera del interior.
- Monumentos: diez módulos, 1.126.998 B sumados. La tabla antigua de MADRID.md precede al último rediseño.
- Disco real: 7,4 GiB libres, no 11. Cachés nuevos en `/tmp`; nada de ZIP municipal de 2,2 GB.
- Referencias externas: se intentó acceder a [TinyWarsaw](https://tinywarsaw.app/preview/engine/) y
  [Pages actual](https://germanpadua.github.io/slop-madrid/); el navegador de lectura devolvió error interno.
  No se han inspeccionado frames ni se ha copiado código/assets. NYC se estudia por diff local.

## A. Datos, cobertura y fidelidad — pendiente

| Sistema | Estado NYC (09361be) | Madrid en la línea base | Plan para paridad | Coste estimado |
|---|---|---|---|---|
| Cobertura | Manhattan detallado + boroughs y horizonte | 8 cores listos, 77 pendientes con rejilla oscura | Extracto OSM PBF local, osmium por celda, alturas IDEAM cacheadas; primero vecinos centrales | 1–3 h pipeline; descarga depende de fuente |
| Huellas y alturas | Volúmenes procedurales por manzana | Semilla raster 12 m + alturas por centro; tesela usa bbox por parcela | Extrusión de anillo real; conservar alturas, no fabricar plazas/techos | 2–4 h |
| Costuras | Mundo estático continuo | Propiedad por >50 % de área; bloque que toca fetch descartado | Verificar dedupe incluyendo semilla; registrar casos sin dueño en esquinas y bloques >100 m | 2–4 h, regeneración aparte |
| Barrios | Límites/zonas NYC completos | Polígonos administrativos sólo en semilla, fallback centro | Llevar límites reales a las nuevas zonas | 1–2 h |
| Agua/puentes | Costas, muelles, puentes modelados | Cauce Manzanares real + tableros por segmento; puentes escultóricos ausentes | Mantener agua/cores, validar cortes del río; mallas sólo con fuente | 2–6 h |

Los stubs de islas, puertos y Central Park son una eliminación geográfica correcta, no piezas que deban copiarse.
Persisten polígonos y elementos NYC aparcados fuera de mapa (`PARKED_Z`, boroughs lejanos); limpiar el acoplo es
trabajo pendiente. El render de bbox por parcela sí es un defecto de fidelidad, aunque pase los tests de datos.

Inspección del propietario (build local `http://localhost:8000/?debug=1`; Pages sólo tras publicación explícita):

- [ ] Volar Sol → Chamberí → Salamanca → Chamartín: manzanas ocupadas donde hay datos, ninguna plaza convertida en torre.
- [ ] Cruzar el borde de semilla junto al Retiro y el Manzanares: ningún duplicado, corte de fachada o franja de agua tapada.
- [ ] Revisar patios en vista cenital: contornos irregulares y vacíos legibles; no cajas envolventes llenándolos.

## B. Motor y navegación — pendiente

| Sistema | Estado NYC | Madrid en la línea base | Plan para paridad | Coste estimado |
|---|---|---|---|---|
| Tráfico | Grafo de carriles, giros, semáforos; población local fija | `buildRoadNetwork` lee GEO estático; teselas nunca lo actualizan | Red activa con dedupe y cruces, adaptación de simulación sin reset cercano | 4–8 h |
| Peatones | Aceras conectadas, conversaciones, cruces | Rutas derivadas del mismo grafo de semilla | Reconstrucción incremental por tesela y pasos reales | 3–6 h |
| Mapa y búsqueda | Path2D cacheado, etiquetas, edificios, teleports | `LAYERS`, `STREET_LABELS`, límites y búsqueda sólo de semilla | Capas activas por tesela; invalidación de cachés y límites activos | 2–4 h |
| GPS | Trazo ortogonal visual, no router sobre grafo | Mismo trazo heredado, incorrecto en diagonales Madrid | Ruta real por red activa, sin inventar conexión a través de edificios | 2–4 h |
| Parseo | Módulo único estático | `import()` teselas en hilo principal; module cache persiste tras expulsión | Worker de módulo dedicado, terminable; import ?v=md5 dentro del worker | 1–2 h |
| Presupuesto | Mundo estático, culling de lotes | Política 12 MiB/12; no reserva in-flight; semilla omite blocksBytes; loadTile directo esquiva topes | Contabilizar semilla completa, reservas y admisión al completar; medir realmente | 1–2 h |
| LOD lejano | Boroughs de baja resolución + niebla | Semilla detallada / tesela intermedia; sin nivel 0 | Módulos ligeros por core y anillos reales simplificados, reemplazo sin solape | 3–5 h |
| Colisiones/teleports | Índices, suelo, modos, buena cobertura tests | Índice se refresca al cargar; límites de controllers/mapa siguen en semilla | Extender dominio activo sin permitir aterrizajes en celdas pendientes | 2–4 h |

`roads` permite dibujar y etiquetar; no contiene identidad de nodos OSM, acceso, nivel/puente/túnel. No basta unir
cruces 2D indiscriminadamente: fabricaría intersecciones. El generador debe emitir su `roadGraph` por tesela.
También se observa un acoplo peligroso previo: el emisor de graph escribe `[...dir, hw, inner]`, mientras
`road-network.js` desestructura `inner` en el slot 6. Es necesario corregirlo al integrar la red.

Inspección (`http://localhost:8000/?debug=1`):

- [ ] Abrir M en Retiro/Chamberí; capas, etiquetas y búsqueda deben corresponder a teselas activas y desaparecer al expulsarlas.
- [ ] Circular de semilla a una tesela: coches en calzadas reales, sin saltos/reset visibles cerca del jugador.
- [ ] Red Network: peticiones por módulo con `?v=<md5>`; memoria acotada tras ida/vuelta y fallos sin tormenta de peticiones.
- [ ] Performance: import/parse de tesela en worker; construcción de mallas sigue en hilo principal y se mide por separado.

## C. Acabado y localización — pendiente

| Sistema | Estado NYC | Madrid en la línea base | Plan para paridad | Coste estimado |
|---|---|---|---|---|
| Fachadas/masificación | 6 familias, tiendas, retranqueos, cornisas, fire escapes, azoteas | Semilla conserva muchas rutinas NYC, 3 perfiles Madrid; teselas sólo 3 fachadas/cajas | Variación estilizada sobre huella real; detalles sin añadir volumen no documentado | 3–6 h |
| Árboles/parques | Árboles procedurales con LOD, Central Park detallado | Césped OSM; gran parte del arbolado sigue ramas Central Park desactivadas; teselas sin árboles | Puntos natural=tree reales y vegetación documentada, con LOD reutilizado | 2–3 h |
| Farolas/señales | Polos y lentes, luces cercanas en pools | Sigue street-details NYC (incluye vapor, metro MTA, carros y señales NYC en coordenadas heredadas); teselas no reciben detalles | Sustituir puntos autorados por OSM documentado; instanciar mobiliario real | 3–6 h |
| Pintura vial | Grafo físico completo, marcas/carriles y cruces | Sólo red de semilla; mezcla ejes rectos NYC y grafo Madrid | Llevar road-paint a red real activa, respetar peatonales y niveles | 2–4 h |
| Vehículos/aparcados | Coches, buses MTA, policía, geometrías/luces pulidas | Geometría intacta pero cartelería M1/5 AV/HARLEM, libreas NYC | Localizar texto; aparcados sólo emplazamientos con fuente | 1–3 h |
| Hitos | ~12 modelos manuales icónicos con detalles | 10 módulos municipales/low-poly preservados; otros hitos extrusión; Atocha sin fachada | Conservar contrato; evitar doble parcela bajo malla; nuevas piezas sólo con fuente | 2–8 h por pieza |
| Noche | Día/noche, interiores, luces calle y reflejos | Materiales/lighting intactos; monumentos sin iluminación dedicada | Iluminación estilizada enlazada a uniformes nocturnos y carga de monumentos | 1–2 h |
| POIs/cámaras | Presets y teleports NYC icónicos | Teleports reales centrales; cámaras renombradas con varias coordenadas de fase 1 imprecisas | POIs desde datos, estadio/museos sólo si están cubiertos; corregir cámaras desde hitos | 1–3 h |
| Audio | Fuentes de tráfico, peatones, vapor, viento y oclusión | Conservado, pero fuentes vinculadas a elementos NYC y a población semilla | Conectar fuentes a mobiliario y red activas reales | 2–3 h |
| UI/controles | Modos coche/bici/pie/heli; ratón, teclado, táctil/gamepad | Conservados y tests verdes; etiquetas internas NYC | Mantener contratos; traducir contenido geográfico incorrecto | 1–2 h |

No se atribuye paridad sólo porque el módulo heredado no tenga diff. El estilo de dibujo se conserva; los elementos
geográficos o arquitectónicos NYC sin fuente Madrid no cuentan como detalle válido. Variación de color/material y
modelos low-poly documentados son representaciones, no mediciones de material de fachada.

Inspección (`http://localhost:8000/?debug=1`):

- [ ] Día/noche en Cibeles, Alcalá, Palacio y Debod: siluetas preservadas, base apoyada, luz cálida sin doble edificio.
- [ ] Retiro: verde y arbolado dentro del parque, agua y caminos abiertos; variación de fachada sin falsa altura.
- [ ] Conducir Sol–Gran Vía: señales/cárteles sin destinos NYC, sin bocas MTA ni vapor Con Edison inventados.
- [ ] Probar pie/bici/coche/heli y cámaras; teleports sobre suelo/calzada transitables mirando al hito correcto.

## D. Rendimiento, mediciones y límites — pendiente

| Sistema | Estado NYC | Madrid en la línea base | Plan para paridad | Coste estimado |
|---|---|---|---|---|
| Culling | Lotes estáticos 500/1000 m, árboles/vehículos con LOD | Conservado en semilla; grupo entero de cada tesela sin partición equivalente | Medir triángulos/draw calls, culling por core y LOD real | 2–4 h |
| Arranque | Mundo único, construcción síncrona | Fase 3 midió 5,75 s CPU; frame SwiftShader ~151 s | Harness CPU sin WebGPU + métricas del worker, no fingir FPS | 1–2 h |
| Memoria | No contrato de streaming | Bytes JS de red no equivalen a heap ni VRAM | Informar bytes de módulos, reservas, buffers estimados/medidos por separado | 1–2 h |
| GPU/FPS | Validación upstream en navegador | Device destruido incluso en ejemplo mínimo (histórico) | Propietario con GPU: ?debug y Performance, mismos recorridos antes/después | bloqueado aquí |

No ejecutar de nuevo una compilación WebGPU masiva en SwiftShader: no responde a la pregunta de FPS real.
Usar `tools/madrid/measure.mjs` con modo CPU si se añade; conservar modo GPU para el propietario.

Inspección (`http://localhost:8000/?debug=1`; `https://germanpadua.github.io/slop-madrid/` aún es fase 3):

- [ ] Recorrido idéntico Sol–Retiro–Chamberí, registrar hardware/navegador, mediana y p95 de frame/long tasks.
- [ ] `window.__madrid`: residentes ≤12, bytes de módulos ≤12 MiB, monumentos ≤2 MiB; medir heap aparte.
- [ ] No device lost, errores de red ni crecimiento continuo de objetos tras tres recorridos de ida y vuelta.

## Registro de ejecución

Auditoría cerrada antes de escribir código de producto. Estado y próximos comandos en `PARIDAD-PLAN.md`.
