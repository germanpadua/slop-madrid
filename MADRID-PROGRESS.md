# Continuación desde 1532896

Rama de trabajo: `wip/madrid-experience`. No se ha publicado ni modificado `feat/madrid`.

## Cambios

- Cámara «Maqueta de Madrid», centrada en el explorador, con giro y zoom mediante los controles existentes. Disponible en el menú de cámaras.
- Streaming: las importaciones pendientes reservan bytes y plazas en el presupuesto; los módulos que llegan después de abandonar la zona no construyen geometría obsoleta. El teletransporte no se interpreta como velocidad de vuelo para el look-ahead.
- Los fallos asíncronos de inicialización muestran una recuperación mediante WebGL.
- Verificador: cuenta fotogramas desde la aplicación, detecta pérdida de contexto, expone consola con VERBOSE y permite guardar capturas. El antiguo contador del renderer devolvía cero en esta versión de Three.js; no permitía concluir que no se renderizaba.
- README actualizado con arranque y validación; PRODUCT.md recoge la dirección confirmada por el usuario.

## Referencia examinada

[Notas del motor de Tiny Warsaw](https://tinywarsaw.app/preview/engine/), consultadas el 28-10-2026. Su separación entre detalle cercano y niveles lejanos preconstruidos encaja con la experiencia pedida. Propuesta para Madrid: preservar patios y monumentos cerca, sustituir fachada detallada por volúmenes de manzana y cubiertas a distancia. Requiere medición y validación; no está implementado en esta entrega.

## Validación y límites

153/153 pruebas CJS pasan con permisos para lanzar los subprocesos de Node. En el sandbox, la suite de sintaxis falla por la restricción de subprocesos; con permisos pasa.

Una ejecución completa con Chromium 149 / SwiftShader, WebGL, 1280×720, n=1 retiró el cargador en 20,3 segundos, pero perdió el contexto gráfico. Ese resultado no valida estabilidad ni rendimiento. El verificador ahora lo marca explícitamente como fallo.

Una segunda ejecución retiró el cargador, pero la captura agotó 30 segundos esperando las fuentes. No hay captura validada. El sandbox no exponía `/dev/dri`; la comprobación posterior con permisos de navegador sí detectó y utilizó la GPU local (véase la siguiente iteración). El verificador libera ahora navegador y servidor también cuando falla.

No se han regenerado las diez teselas sin patios: faltan las fuentes pesadas excluidas. Tampoco se ha activado merged-zone en la aplicación principal ni se ha afirmado una mejora de FPS.

## Próximos hitos necesarios para alcanzar las referencias

1. Validación visual y de continuidad de renderizado en GPU real, escritorio y móvil.
2. Niveles lejanos para maqueta aérea y reducción de materiales activos durante el arranque.
3. Evaluación comparada de merged-zone y baseline con cámaras y rutas idénticas.
4. Regeneración de patios al disponer de fuentes y permisos.
5. Revisión de monumentos y transición de cubiertas por barrios desde referencias documentadas.

## Límite de reversión

Esta unidad se revierte retirando la cámara maqueta (cameras.js y botón HTML), las reservas del streamer, la recuperación de arranque y los diagnósticos asociados, junto con sus pruebas y documentos. No cambia datos geográficos ni el prototipo merged-zone.

## Iteración autónoma: GPU y arquitectura

Se corrigió el diagnóstico de GPU: Chromium ejecutado fuera del sandbox utiliza **Intel Iris Xe (RPL-P), Mesa 26.0.8, ANGLE OpenGL**. La ausencia de `/dev/dri` dentro del sandbox no describía el equipo anfitrión.

Cambios verificados:

- El generador heredado de boroughs de Nueva York ya no se importa ni ejecuta: emitía 15.447 edificios ficticios. Madrid conserva el centro geográfico y las teselas.
- Los edificios de Madrid no emiten escaleras exteriores de incendios ni depósitos de madera de Manhattan. Tampoco se construyen sus mallas vacías.
- La precompilación ignora InstancedMesh con cero instancias.
- Se corrigió el solapamiento de las señales de calle con los modos de navegación en pantallas estrechas.
- El verificador registra la GPU y captura calle y maqueta en escritorio y maqueta a 390×844 con entrada táctil emulada. Comprueba ausencia de boroughs y escaleras, continuidad de renderizado y ausencia de solapamiento móvil.

Resultado de confirmación (WebGL, 1280×720, GPU indicada, n=1): `passed=true`, arranque 23.749 ms, 100 fotogramas durante la muestra de unos 3 s (33,33 FPS), sin pérdida de contexto, sin errores de página ni peticiones fallidas; cero instancias de escaleras y sin grupo Boroughs. 153/153 pruebas CJS pasan. Es una comprobación funcional y una muestra exploratoria, no un benchmark comparativo ni una prueba en teléfono físico.

Capturas locales inspeccionadas: `/tmp/madrid-confirmed/street-desktop.png`, `/tmp/madrid-confirmed/model-desktop.png`, `/tmp/madrid-confirmed/model-mobile.png`. Informe local: `/tmp/madrid-confirmed.json`.

La maqueta todavía muestra diferencias de tratamiento entre el centro procedural y las teselas. La siguiente mejora visual debe unificar cubiertas y materiales sin perder patios. El arranque sigue siendo lento; no se considera resuelto el objetivo de rendimiento.

Reversión de esta iteración: restaurar el import y llamada a buildBoroughs y su preload, retirar la exclusión de escaleras/depósitos de commit(), restaurar createFireEscapes y retirar el filtro de mallas vacías. Los ajustes móviles y del verificador son independientes.

### Backend por defecto

La prueba posterior de streaming con el backend WebGPU retiró el cargador en 32.918 ms y cargó k3j1, pero registró errores `GPUValidationError: Binding size … is zero`. La muestra de renderizado fue de solo 3 frames en unos 9,5 s durante la carga. No es un resultado válido de calidad. El antiguo criterio `passed` no incluía estos errores de consola; se corrigió para detectarlos y comprobar también el resultado de todas las teselas solicitadas.

Se seleccionó WebGL2 como backend predeterminado, conservando `?webgpu=1` para experimentación explícita. El HUD muestra el backend realmente utilizado. No se ha eliminado el motor WebGPURenderer ni los materiales TSL: Three.js utiliza su backend WebGL2.

Siguiente inconsistencia concreta detectada: el centro procedural crea sus materiales con opciones heredadas y no activa el parámetro `madrid` de la fachada que sí utilizan las teselas. Su corrección deberá comprobar ritmo de balcones, materiales compartidos y compilación; no forma parte de esta unidad validada.

### Navegación y estrés de carga

El backend predeterminado corregido pasó una prueba de streaming: WebGL2, sin errores gráficos, k3j1 cargada y 8 teselas residentes sin fallos. El verificador anterior elevaba silenciosamente el radio de precarga a 5 km y medía mientras compilaba las nuevas teselas: en ese escenario obtuvo 3 frames en unos 7 s. Es un bloqueo visible y no se considera rendimiento aceptable. Se ha separado esa fase artificial mediante `--stress`; la ruta normal conserva el radio de precarga de la aplicación. No se oculta ni se elimina la prueba de estrés.

### Resultado final de ruta normal

La ruta normal también pasó los controles funcionales (WebGL2, arranque 24.439 ms, tesela k3j1 cargada, sin errores gráficos), pero la muestra de 5 frames en unos 24 s revela que el bloqueo al compilar nuevas zonas también afecta al recorrido normal. Separar `--stress` no lo resuelve. Queda como problema prioritario: preparar o simplificar los materiales/geometrías de nuevas teselas antes de su primer dibujo, midiendo la latencia máxima de frame y el tiempo hasta estabilizarse. No se declara resuelto el rendimiento ni alcanzada la calidad de las referencias.

Resumen reproducible de las muestras en `docs/validation/2026-10-28-gpu.json`. Las capturas móviles son emulación táctil sobre la GPU del escritorio, no una medida de teléfono físico.

## Optimización de preparación de teselas

Se aisló el coste de importación, preparación y montaje de teselas; el modo debug conserva hasta 600 muestras de intervalo entre frames y tiempo dentro de renderizado. En una ruta exploratoria sobre Iris Xe, antes de optimizar, la construcción de k2j-1 tardó 9.453 ms y la de k4j2 15.391 ms; el mayor intervalo observado durante la ruta fue 4.683 ms. No se atribuye todo ese intervalo a GPU: el mayor tiempo dentro de renderizado fue 415 ms.

Se precalculan una sola vez los límites proyectados de cada rectángulo para la prueba de desviación 48×48, y se usa una cuadrícula espacial para las búsquedas de medianeras. Se mantienen las comparaciones geométricas originales, su tolerancia y su orden. El benchmark reproducible contra 77921de comprueba igualdad exacta en las 1.160 parcelas de k3j0, con tres pares por algoritmo:

```sh
node tools/madrid/benchmark-preparation.mjs 77921de k3j0
node --test tests/madrid-adjacency.test.cjs tests/madrid-footprint-holes.test.cjs
```

Resultados de CPU en `docs/validation/2026-10-28-preparation-cpu.json`. La prueba de regresión compara los resultados completos de medianeras con hashes generados por la búsqueda exhaustiva anterior. Reversión: madrid-footprint.js y madrid-adjacency.js; los cambios de cálculo no dependen del worker ni de los materiales.
