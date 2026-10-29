# Piezas procedurales de Madrid

`monumentos_emitir.py` regenera exclusivamente Cibeles (escultura), Neptuno,
Debod y Cervantes (`plazaespana`). Mantiene el contrato `MONUMENT` y actualiza
los tamaños, hashes y totales del manifiesto. No descarga ni reconstruye las
otras seis mallas municipales.

En Cibeles, los primeros 3371 vértices y 7791 triángulos pertenecen al bacín
original: se conservan exactamente sus posiciones, colores, índices y origen.
`proceduralStart` documenta la separación y permite regenerar la talla sin
acumular versiones anteriores. Los tests fijan los hashes de ese prefijo y de
los seis módulos protegidos. La primera migración comprueba también el tamaño
y la independencia de los índices del bloque antiguo.

Las formas manuales combinan superficies elipsoidales, tubos articulados,
anillos, volutas, ruedas caladas, roca irregular reproducible y elementos
arquitectónicos. Las caras de las primitivas tienen normales exteriores para
el material FrontSide del visor. Se eliminan los triángulos procedurales que
colapsan al cuantizar a 0,1 m; las caras municipales se conservan sin filtrar.

Son interpretaciones del brief, no levantamientos municipales ni
reconstrucciones arqueológicas. En particular, Debod lleva el pico bajo a dos
aguas solicitado, y Quijote y Sancho aparecen de pie según la petición.

## Regeneración y revisión

Desde la raíz del repositorio, con el entorno de numpy y Pillow indicado para
este proyecto:

```bash
~/workspace/artifacts/tiny-madrid-north-r4/venv/bin/python tools/madrid/monumentos_emitir.py
~/workspace/artifacts/tiny-madrid-north-r4/venv/bin/python tools/madrid/monumentos_render.py
~/workspace/artifacts/tiny-madrid-north-r4/venv/bin/python tools/madrid/monumentos_qc.py cibeles neptuno debod plazaespana --round 1
node --test tests/*.test.cjs tests/*.test.mjs
```

El render lee los buffers de los módulos emitidos. Usa proyección ortográfica
azimut 45° / elevación 30°, iluminación difusa, descarte de caras traseras,
ordenación painter y z-buffer baricéntrico. Guarda hojas de conjunto y detalle,
y vistas completas, en `/tmp/monumentos-codex/`. Para Debod, el segundo panel
muestra el reverso a 225° para revisar el pórtico posterior. El renderer no
sustituye una revisión interactiva con el visor.

El QC envía cada hoja al endpoint solicitado de nan.builders con
`deepseek-v4-flash`, `max_tokens: 1500`, `temperature: 0` y thinking desactivado
para reservar el presupuesto a la respuesta visible. La clave se lee sólo en
memoria desde `~/.nan_api_key`. No se imprime ni se persiste en los artefactos.
Las respuestas y el SHA256 de cada imagen quedan en `*-qc-rN.json` y `qc.md`.
El script admite rondas 1–3 y rechaza sobrescribir una ronda ya revisada.

Para una corrección, emitir de nuevo, renderizar las piezas afectadas con
`--round 2` (o `3`) y pedir QC sólo para esas piezas con el mismo número.
Los veredictos son ayuda de revisión: pueden confundir elementos o atribuir
una oclusión a la geometría. El propietario debe valorar las imágenes.
