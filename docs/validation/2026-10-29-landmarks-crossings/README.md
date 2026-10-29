# Reservas de edificios y cruces con fuente

La reserva de huellas antes limitada al Palacio de Cibeles se aplica ahora a los edificios con building=1, ring y ancho>=12m. La medición del generador residente da0 masas solapadas en las23 entradas de la semilla (incluye dos nombres de Príncipe Pío). No se afirma que no existan otros tipos de solapamientos en toda la ciudad. El inspector guarda contadores por nombre en model-after.json.

Las cubiertas de los landmarks genéricos coincidían exactamente con las tapas de sus extrusiones: se elevan3cm para que su material de cubierta sea visible. Esto corrige el defecto de renderizado; no añade patios ni corrige la forma de esos edificios. Cibeles procedural conserva su material propio. No presentar el Banco de España como arquitectura terminada: conserva su masa simplificada.

## Pasos de cebra

Ya no se pinta un paso en todos los extremos de aristas. Se extrajeron4669 nodos OSM explícitamente marcados y2423 vías footway=crossing conectadas a esos nodos. Se dibuja la polilínea original de cada vía, conservando isletas/divisiones, únicamente cerca de la red residente. Ancho del paso3,7m y ritmo de franjas siguen siendo ilustrativos; no son medidas levantadas. Cruces sin evidencia de marcas quedan sin pintar. La fuente puede estar incompleta.

Se retiraron las barras de parada automáticas y los carriles bici verdes inferidos; la paleta central usa blanco. Las líneas de carril aún son procedurales. Se incluyen trunk/trunk_link de superficie en la red urbana: la plaza contiene estas vías; túneles/puentes/niveles sin perfil resuelto siguen excluidos.

Datos OSM/Geofabrik, ODbL-1.0. SHA256 del PBF en el módulo generado. Reproducción (fuentes temporales):

```
PYTHONPATH=/tmp/madrid-osmium /home/germanpadua/.local/share/uv/python/cpython-3.13.15-linux-x86_64-gnu/bin/python tools/madrid/extract-marked-crossings.py /tmp/madrid-paridad.osm.pbf /tmp/madrid-marked-crossings.json
node tools/madrid/pack-marked-crossings.mjs /tmp/madrid-marked-crossings.json /tmp/madrid-osm-features.json
```

El módulo añade307241B estáticos fuera del manifiesto de teselas; no se eleva el límite residente. Suma orientativa con los12089352B de módulos ready documentados:12396593B, dentro de12MiB; no equivale a memoria/VRAM ni a toda la descarga de aplicación.

## Validación

194/194 pruebas, sintaxis y diff check correctos. Captura final inspeccionada en Iris Xe con la misma cámara de maqueta Cibeles; cero invasiones de las huellas registradas. Pintura reconstruida en24,7ms en esa muestra. El filtro espacial evita el ensayo inicial de221ms por barrido exhaustivo; muestras distintas, no benchmark general. No se ha probado móvil físico ni declarado paridad con referencias.
