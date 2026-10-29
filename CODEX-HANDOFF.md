# Madrid: estado vigente, 29 de octubre de 2026

## Retomar aquí

Repositorio `/home/germanpadua/proyectos/slop-madrid/slop-madrid`, rama **feat/paridad**. Verificar `git status --short` y `git log -8 --oneline`. Leer este documento y `PRODUCT.md`; `PARIDAD-PLAN.md`/`MADRID-PARIDAD.md` contienen auditoría e historia, no todos sus pendientes siguen abiertos. Handoff anterior completo: `git show 6a1dee5:CODEX-HANDOFF.md`.

**Prioridad explícita más reciente:** edificios, monumentos y calles fieles por encima de muchos coches/peatones. La simulación es ambientación secundaria. No dedicar otra ronda a aumentar población ni usar su número como criterio de acabado. El usuario autoriza trabajo autónomo y delegación en subagentes, también modelos más ligeros.

Objetivo incompleto: ciudad reconocible a pie y como maqueta, con calidad comparable a TinyWarsaw. No declarar paridad por tests verdes ni por una vista de Cibeles. Mantener flat shading y paleta Madrid. Las dimensiones de detalle ilustrativas deben distinguirse de medidas reales.

## Restricciones conservadas

- Commits locales pequeños en feat/paridad. **No push, deploy ni merge**; el estado heredado reserva la publicación al propietario.
- Datos con fuente OSM/Catastro/IDEAM/i3s; no poblar calles ni edificios al azar para simular cobertura.
- Presupuesto sin elevar: 12 MiB de módulos / 12 teselas residentes. No equivale a memoria JS/VRAM. 12 entradas ready, incluida semilla, de 85; la otra línea citada de 19 teselas no está reconciliada.
- No subir datos fuente pesados ni fotografías de referencia con redistribución pendiente. Las imágenes oficiales de Cibeles se inspeccionaron temporalmente, no se incluyeron en git.
- WebGL2 sigue predeterminado; WebGPU y `?detail=geometry`/`?detail=distance` siguen experimentales.

## Cerrado en esta continuación

1. **Pintura completa y recuperación de worker** (`27e6f10`, precarga en `2007dae` y actualización del inventario posterior): transporta `paintEdges` físicos con identidad de nodos/shape. 4.581 aristas físicas iniciales frente a 2.884 de routing. `madrid-road-prepare-data.js` comparte preparación; si falla/no existe Worker se calcula el snapshot vigente en main, conservando descarte por versión. `roadStats.mode` = worker/main-fallback. Respaldo validado bloqueando el worker en Chromium; puede causar pausas síncronas. La geometría de pintura aún se genera en main (12–40 ms observados), no afirmar que ya está en worker.
2. **Peatones y fuente** (`60b9949`): los caminantes en dirección inversa remapean por orientación de su track, conservando dir. Fuente de Cibeles plana ya no tiene collider elevado invisible. La fuente escultórica sigue pendiente; eliminar el collider no la modela.
3. **GPU/cielo**: `/dev/dri` existe fuera del sandbox. Chromium autorizado con `HARDWARE_GPU=1` confirma Intel Iris Xe. La caja a 100 km es SkyMesh atmosférico, ahora nombrado MadridAtmosphericSky; no se eliminó ni cambió su shader. Las bandas de software no aparecen en la misma cámara sobre Iris Xe. Causa interna del artefacto software aún no resuelta.
4. **Palacio de Cibeles**: entrada/torres reorientadas a fachada noroeste usando huella OSM y documentación municipal; galerías visibles, ventanas estrechas, coronaciones con pináculos en lugar de grandes conos. Reloj bajo la galería superior, caras orientadas correctamente, altura máxima70 m documentada. Tambor inferior conectado al cuerpo28 m para evitar que flote. Huella original sin reescalar. Dimensiones menores y posiciones de detalle son aproximaciones documentadas.
5. **Solapamientos**: reserva poligonal activa solo para Palacio de Cibeles. Medición de volúmenes genéricos dentro de la huella: **35→0**. Se omite el edificio generado completo si alguna masa invade el polígono; contacto de bordes no cuenta. Se conservan decisiones aleatorias en salida descartada para no cambiar edificios posteriores. No aplicar todavía a todos los landmarks sin validar por lugar. Helper nuevo `madrid-landmark-reserves.js`.

## Evidencia y límites

- Suite final **192/192**; sintaxis de harness y `git diff --check` correctos. Prueba boot exige49 precargas y valida todas las dependencias; mantenerla al introducir módulos.
- `docs/validation/2026-10-29-sky/`: misma cámara de Gran Vía con bandas software/cielo limpio hardware. Es comparación de adaptadores, no una optimización probada.
- `docs/validation/2026-10-29-hardware-circulation/`: 199–200 coches,334–340 peatones, cero rutas obsoletas/posiciones inválidas/carriles fuera de calzada, descarga elimina nodos de seis teselas. Adaptador real registrado. **Teletransportes**, no paseo continuo ni móvil físico. Swaps main4,3–7,4 ms excluyen generación de pintura/migración. Arranque9,95 s de una muestra, no comparación controlada.
- `docs/validation/2026-10-29-road-recovery/worker-blocked.json`: fallbackPassed=true, los errores de petición son el bloqueo deliberado del worker.
- `docs/validation/2026-10-29-cibeles/`: antes/después de solapamiento, captura de calle final y maqueta. Comparar calle con `../2026-10-29-hardware-circulation/street-cibeles.jpg` (antes). Fuente/limitaciones arquitectónicas en `docs/validation/2026-10-29-cibeles-architecture.md`.
- Las pruebas geométricas no sustituyen inspección de fotos/modelo. El palacio sigue muy simplificado: cuerpos superiores, patios, relieves y ritmos exactos de ventanas pendientes. Fuente sigue plana, plaza muy vacía. No confundir esta corrección con monumento terminado.

## Siguientes tareas, por prioridad actual

1. Completar el conjunto Cibeles con referencias: fuente, proporciones/ritmos del palacio y configuración de plaza/calzadas. Revisar las masas con imágenes oficiales y huellas; no inventar detalle que parezca medido.
2. Repetir auditoría de edificios genéricos que invaden monumentos en otros lugares; ampliar reservas solo tras verificar polígono y vecinos. Revisar tres manzanas/patios, incluidos17 casos k3j0, desde cámaras repetibles.
3. Corregir huellas/alturas/cubiertas del centro y siluetas de hitos antes de añadir ambientación. La reserva de Cibeles no corrige el generador del resto de Madrid.
4. Adecuar calzadas y marcas a Madrid: siguen patrones heredados (línea doble amarilla/hipótesis de carril bici), no afirmar que la pintura corresponde señal por señal a datos reales. Semáforos visibles/sincronizados y mobiliario con fuente siguen pendientes.
5. Reducir complejidad/población si favorece fidelidad y fluidez, con mediciones comparables. LOD geométrico del centro, móvil físico y paseo continuo cruzando teselas siguen sin cerrar.
6. Recuperar fuentes/conciliar19 frente12 teselas antes de ampliar cobertura. No subir presupuesto ni inventar alturas para rellenar huecos.

## Ejecución y comprobaciones

Web estática, sin package.json/build. `python3 -m http.server 8080 --bind 127.0.0.1`.

Suite: `node --test tests/*.test.cjs`. El sandbox restringe spawn de Node y provoca falsos errores en TODOS los módulos del test de sintaxis: ejecutarla con permisos de subprocesos autorizados. `.git` también requiere ejecución autorizada para commits.

Rutas locales de herramientas (verificar):

```
PLAYWRIGHT_MODULE=/home/germanpadua/.npm/_npx/ad9a3fdbcad992c6/node_modules/playwright-core/index.mjs
CHROME_PATH=/home/germanpadua/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome
```

Navegador fuera del sandbox con `HARDWARE_GPU=1`; comprobar `glRenderer` en JSON, no inferir hardware del nombre del comando. Ejecutar una prueba GPU a la vez.

- `tools/madrid/inspect-scene.mjs --place cibeles --wait 6000 --shot /tmp/cibeles.jpg --json-out /tmp/cibeles.json`: raycast, cámara asentada y solapamientos del palacio. `--view maqueta --zoom 0.45` para aéreo. `--buildings-file /tmp/before.js` permite comparar generador histórico sin tocar checkout. Diagnostica error de inicio y cierra navegador/servidor en finally.
- `tools/madrid/check-circulation.mjs --out /tmp/circulation`: teletransportes, descarga, adaptador, gates de consistencia. No llamarlo paseo continuo.
- `tools/madrid/debug-boot.mjs --after 5000 --fail-road-worker`: fallo deliberado y gate de fallback.
- `tools/madrid/measure.mjs --tiles k3j0,k3j1 --check-street-lifecycle`: streaming/vegetación/atributos CPU, no VRAM. También --places/--aerial. Ver historial para más opciones.

Una primera recaptura Cibeles agotó timeout de arranque180 s sin diagnóstico suficiente; la repetición con logs y detección temprana arrancó correctamente. No atribuir causa no demostrada; el harness ahora hace visible el fallo de init. Los módulos Three siguen cargados desde CDN `@dev`, riesgo reproducibilidad pendiente.

## Fuentes temporales

OSM descargado por la sesión anterior: `/tmp/madrid-paridad.osm.pbf`, `/tmp/madrid-osm-features.json`, pyosmium en `/tmp/madrid-osmium`; hashes/reproducción en handoff anterior. Fuentes pesadas IDEAM/Catastro para regenerar edificios/patios siguen sin `tools/data/madrid`.

Diagnósticos heredados no publicados conservados en `/tmp/madrid-inherited-diagnostics/`; la evidencia útil del cielo se copió a docs. Los JPG/JSON históricos de paint-granvia se restauraron a su versión git tras archivar las modificaciones temporales. No se perdieron diagnósticos del trabajo recibido.

## Avance posterior: plaza y topología

Se corrigió el rectángulo histórico de Plaza de la Cibeles que tapaba92×89 m de calzadas: era AABB de calles abiertas con nombre, no geometría peatonal. build.mjs marca futuros fallback name-bounds/renderSurface=false y no los incorpora a plazasMadrid; landmarks respeta esa marca y omite solo la compatibilidad histórica de Cibeles sin superficie explícita. Evidencia inspeccionada con Iris Xe en docs/validation/2026-10-29-cibeles-plaza/, suite192/192. La fuente sigue plana; la corrección revela calzada, no completa el conjunto.

Nuevo extractor reproducible tools/madrid/extract-landmark-topology.py recupera relaciones/roles/nodos originales desde PBF. Banco de España: relación2614014, outer4487661 y seis inner; el generador actual los descarta. No abrirlos a ciegas: hay patios y lucernarios cubiertos. Palacio Cibeles: way16322055; Galería de Cristal tiene cubierta real. La extracción queda en /tmp/madrid-landmark-topology.json si se conserva esta máquina. No se han cambiado aún renderer ni datos de edificios con esos interiores.

## Corrección posterior por revisión del propietario

El propietario señaló bloques blancos, más solapamientos y pasos de cebra incorrectos. Reserva ampliada a todas las23 entradas building=1 de la semilla: captura GPU con0 masas genéricas dentro de sus huellas. Cubiertas genéricas elevadas3cm sobre tapas coplanares: material visible; las grandes masas y patios siguen sin resolver. Evidencia actual: docs/validation/2026-10-29-landmarks-crossings/.

Pasos de cebra ahora usan2423 polilíneas peatonales OSM vinculadas a4669 nodos explícitamente marcados. No se extrapolan cruces a todos los extremos de calle. Ancho/franjas ilustrativos; pueden faltar cruces sin marcas registradas. Eliminados carriles bici verdes y barras de parada inferidos. Trunk de superficie incluido para calles de Cibeles; exclusión de túneles/puentes conservada. Módulo estático nuevo307241B, precargas51. Pintura main24,7ms de muestra. Suite194/194. Continuar con volumetría/patios/fachadas y fuente: estos cambios aún no hacen fiel el conjunto.
