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

Una segunda ejecución retiró el cargador, pero la captura agotó 30 segundos esperando las fuentes. No hay captura validada. Este entorno no expone `/dev/dri`; la comprobación visual y de GPU real sigue pendiente. El verificador libera ahora navegador y servidor también cuando falla.

No se han regenerado las diez teselas sin patios: faltan las fuentes pesadas excluidas. Tampoco se ha activado merged-zone en la aplicación principal ni se ha afirmado una mejora de FPS.

## Próximos hitos necesarios para alcanzar las referencias

1. Validación visual y de continuidad de renderizado en GPU real, escritorio y móvil.
2. Niveles lejanos para maqueta aérea y reducción de materiales activos durante el arranque.
3. Evaluación comparada de merged-zone y baseline con cámaras y rutas idénticas.
4. Regeneración de patios al disponer de fuentes y permisos.
5. Revisión de monumentos y transición de cubiertas por barrios desde referencias documentadas.

## Límite de reversión

Esta unidad se revierte retirando la cámara maqueta (cameras.js y botón HTML), las reservas del streamer, la recuperación de arranque y los diagnósticos asociados, junto con sus pruebas y documentos. No cambia datos geográficos ni el prototipo merged-zone.
