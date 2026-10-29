# Madrid explorable

Experiencia web para explorar una recreación de Madrid desde la calle y como maqueta aérea.

## Dirección acordada

El usuario prioriza una ciudad razonablemente fiel con monumentos y barrios reconocibles. Los edificios secundarios pueden ser genéricos para optimizar el rendimiento. La vista aérea es parte central de la experiencia, junto con el paseo por sus calles. Referencias: Tiny Warsaw y Slop New York.

La fidelidad se concentra en trazado urbano, manzanas, patios, alturas y siluetas de monumentos. Las paletas procedurales son ilustrativas. La geometría fusionada sigue siendo experimental; no se activa globalmente sin validación visual y de rendimiento.

Prioridad confirmada el 29 de octubre: edificios, monumentos y calles fieles por encima de la cantidad de vehículos y peatones. La simulación es ambientación secundaria; no aumentar poblaciones como criterio de calidad. Su cantidad puede reducirse para favorecer la fidelidad y la fluidez.

## Restricciones

No publicar cambios ni subir datos fuente con permisos de redistribución pendientes. El ámbito disponible es el del manifiesto de teselas; no se presenta como cobertura completa del municipio.

## Siguiente criterio de calidad

Verificar arranque y continuidad de renderizado, navegación aérea y a pie, y legibilidad de los monumentos en escritorio y móvil antes de comparar la experiencia final con las referencias. Las mediciones con rasterización por software no representan el rendimiento de una GPU de usuario.

## Revisión visual del propietario

La maqueta actual no está aceptada: parpadeo, fondo visible, monumentos poco fieles, fuente ausente y parques incorrectos. Referencia prioritaria: TinyWarsaw. Antes de ampliar cobertura/población, Cibeles y entorno deben servir como muestra convincente de arquitectura, calles, vegetación y estabilidad al orbitar. Revisar en movimiento y a pie; no sustituir esa revisión por contadores o tests.

## Dirección estática vigente

Coches, autobuses y peatones ambientales **desactivados** hasta alcanzar el estilo y calidad solicitados. El usuario pidió expresamente mantenerlos apagados. No reactivarlos como una mejora de ambientación. Arranque en persona + maqueta + mediodía; materiales mates, luz simple, sin SSR/bloom. Los modos de exploración del jugador permanecen disponibles.

Retiro con caminos OSM y posiciones/alturas del inventario municipal; copas ilustrativas. Monumentos con masas de parcelas y topología OSM donde existen. La fuente de Cibeles vuelve a tener una representación escultórica simplificada. Esta dirección aún necesita revisión arquitectónica: no equivale a paridad con TinyWarsaw ni a aceptación visual del propietario.
