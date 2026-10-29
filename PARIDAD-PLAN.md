# Plan de paridad (reanudable)

Rama `feat/paridad`, nacida en `feat/madrid` (791f17c), merge local de `feat/monumentos` (dac8b4e).
Prohibido push/deploy/merge a main. Auditoría detallada y checklists: `MADRID-PARIDAD.md`.

| Bloque | Estado | Orden, razón y criterio de cierre |
|---|---|---|
| 0. Auditar antes de producto | **hecho** | MADRID.md completo, log all, diff upstream, consumidores/datos y suite 137/137; documentos escritos antes de producto |
| A1. Ingesta escalable | **hecho** | `pbf.py`: PBF diario verificado, osmium smart por core, caché IDEAM paginada por envolvente (el servicio no tiene campo distrito); procedencia y md5 por tesela |
| A2. Cobertura | **avance entregado; resto pendiente** | 18/85 listas, 67 pendientes, 23 km² de cores. Diez vecinas conectan semilla, Chamberí, Salamanca y Arganzuela; módulos fase3/semilla preservados |
| B1. Worker y presupuesto | **hecho** | Worker de módulo terminable por tesela, reservas en vuelo, semilla completa, cancelación y admisión directa; reemplazo de residentes lejanos por celdas cercanas sin subir topes |
| B2. Mundo activo y mapa | pendiente | Modelo activo de datos, mapa/cache/búsqueda con alta/baja; grafo emitido por tesela, unión sin intersecciones ficticias |
| B3. Tráfico y LOD | pendiente | Adaptar red/simulación, LOD0; preservar movimiento cercano y no resetear todos los actores en cada carga |
| C. Muestras de acabado fiel | pendiente | Huella exacta de teselas y vegetación con fuente; noche monumentos y localización de textos. No fabricar arquitectura |
| D. Medir y cerrar | pendiente | Suite completa antes de cada commit de cierre, verify hashes, harness CPU, presupuesto y limitaciones; GPU/FPS los valida propietario |

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
   en 12 MiB. No se ha debilitado: total actual 11.077.635 B. La política residente sí cuenta semilla completa.
4. Terminar B y C, actualizar mediciones y límites con evidencia antes de cerrar.
