# Plan de paridad (reanudable)

Rama `feat/paridad`, nacida en `feat/madrid` (791f17c), merge local de `feat/monumentos` (dac8b4e).
Prohibido push/deploy/merge a main. Auditoría detallada y checklists: `MADRID-PARIDAD.md`.

| Bloque | Estado | Orden, razón y criterio de cierre |
|---|---|---|
| 0. Auditar antes de producto | **hecho** | MADRID.md completo, log all, diff upstream, consumidores/datos y suite 137/137; documentos escritos antes de producto |
| A1. Ingesta escalable | pendiente | Descargar PBF público a /tmp, osmium por celda; cache IDEAM por área, sin mega-JSON de entrega. Primero contigüidad de almendra construida |
| A2. Cobertura | pendiente | Generar vecinos centrales y extender al norte/este según fuentes, hashes y dedupe; registrar celdas restantes sin fingir cobertura |
| B1. Worker y presupuesto | pendiente | Antes de ampliar residentes: reservas en vuelo, semilla completa, import en worker terminable; tests de carreras/fallos |
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

1. Instalar/probar osmium y obtener extracto público con procedencia/fecha/hash.
2. Preparar pipeline por tesela sin alterar los módulos conquistados hasta verificar integridad.
3. Mantener esta tabla y el registro de mediciones del informe con cada cierre.
