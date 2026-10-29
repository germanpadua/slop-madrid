# Plan de paridad (reanudable)

Rama `feat/paridad`, nacida en `feat/madrid` (791f17c), merge local de `feat/monumentos` (dac8b4e).
Prohibido push/deploy/merge a main. Auditoría detallada y checklists: `MADRID-PARIDAD.md`.

| Bloque | Estado | Orden, razón y criterio de cierre |
|---|---|---|
| 0. Auditar antes de producto | **hecho** | MADRID.md completo, log all, diff upstream, consumidores/datos y suite 137/137; documentos escritos antes de producto |
| A1. Ingesta escalable | **hecho** | `pbf.py`: PBF diario verificado, osmium smart por core, caché IDEAM paginada por envolvente (el servicio no tiene campo distrito); procedencia y md5 por tesela |
| A2. Cobertura | **avance entregado; resto pendiente** | 18/85 listas, 67 pendientes, 23 km² de cores. Diez vecinas conectan semilla, Chamberí, Salamanca y Arganzuela; módulos fase3/semilla preservados |
| B1. Worker y presupuesto | **hecho** | Worker de módulo terminable por tesela, reservas en vuelo, semilla completa, cancelación y admisión directa; reemplazo de residentes lejanos por celdas cercanas sin subir topes |
| B2. Mundo activo y mapa | **avance entregado** | Alta/baja real de capas, calles, búsqueda, límites y aceras; grafo activo y rutas por vértices reales. Simulación de tráfico todavía usa semilla (B3) |
| B3. Tráfico y LOD | pendiente | Adaptar red/simulación, LOD0; preservar movimiento cercano y no resetear todos los actores en cada carga |
| C. Muestras de acabado fiel | **avance entregado** | Huellas reales cóncavas + 3.504 patios interiores nuevos, 5.989 nodos OSM de árboles/farolas/señales, relleno nocturno estilizado y cartel de bus Madrid. Falta acabado completo/LOD y QC del propietario |
| D. Medir y cerrar | **CPU y contratos hechos; GPU bloqueada aquí** | 152/152 tests, verify 18/85, siete mediciones archivadas y smoke real Path2D/workers sin renderer; FPS y veredicto visual pendientes de GPU del propietario |

Se ejecuta A1 primero para detectar disponibilidad de fuentes; B1 puede continuar durante descargas. Datos antes de
decoración, presupuesto antes de cargar más, geometría fiel antes de variar fachadas. Costes en informe son estimaciones,
no promesa de cierre de todos los subsistemas. Cada commit deja estado concreto; partes incompletas quedan pendientes.

## Línea base

- 8/85 listas, 77 pendientes, 6.788.893 B incluyendo ambos módulos de semilla, 15,20 km² de cores listos.
- 137/137 tests, 66,29 s. Disco libre real 7,4 GiB. osmium no instalado al inicio.
- WebGPU no se valida aquí. No se ha usado ninguna clave/servicio de pago.

## Continuación

1. Caché actual `/tmp/slop-paridad-cache/madrid-261028.osm.pbf`, MD5 `c1dfa14ee00cca5710549dadb49b4e5e`.
   Regenerar las diez nuevas: `python3 tools/madrid/pbf.py --pbf /tmp/slop-paridad-cache/madrid-261028.osm.pbf --rebuild --clean-tile-cache k0j2 k1j2 k2j2 k3j2 k3j0 k1j-1 k3j-1 k1j3 k2j3 k3j3`.
2. `node tools/madrid/tiles.mjs verify`; suite completa; `node tools/madrid/measure.mjs --cpu` (sin GPU).
3. Ampliar cobertura requiere revisar el test histórico que exige que TODOS los módulos publicados quepan juntos
   en 12 MiB. No se ha debilitado: total final 11.395.022 B. La política residente sí cuenta semilla completa.
4. Prioridad siguiente: B3 (migración incremental de carriles/ocupación/peatones) y LOD0, antes de aumentar radios.
   Faltan 67 celdas; no es una ciudad en paridad completa. La cobertura y el acabado ya entregados son el mínimo
   avanzado A/B + muestras C, no un cierre de esas brechas.

## Cierre de esta entrega

- `1aafbe5`: PBF + diez celdas, test del adaptador, dedupe incluyendo semilla; 140/140 tests sobre el índice exportado.
- `2789b9f`: workers y presupuesto real, cancelaciones/cargas concurrentes; 144/144.
- `2757093`: mundo activo, mapa, rutas y límites; 150/150.
- `98a2132`: geometría compacta con patios y puntos OSM, noche y alturas de hitos; 152/152.
- Harness: `node tools/madrid/measure.mjs --cpu`; comparación `--cpu --baseline-ref feat/monumentos`.
  Archivos en `tools/madrid/measurements/2026-10-29-*.json`. Para GPU real, sólo en entorno compatible:
  `node tools/madrid/measure.mjs --native-gpu --tiles k0j2,k1j2,k2j2,k3j2,k1j3,k2j3,k3j3`.
- Inspección manual: servir este checkout con `python3 -m http.server 8000`, abrir
  `http://localhost:8000/?debug=1` con GPU (o reenviar ese puerto). Pages sigue en fase 3 hasta orden explícita.
- No push, no deploy, no merge a main, ningún secreto leído. Cache PBF + alturas 114 MiB en /tmp para reanudar;
  los extractos intermedios de cada celda se eliminaron. Las verificaciones temporales del índice se limpian al cierre.
