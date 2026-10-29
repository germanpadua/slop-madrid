# Madrid estático: revisión de estilo y geometría

Estado de trabajo, **sin aceptación visual ni paridad con TinyWarsaw**. Coches, buses y peatones ambientales apagados por instrucción del propietario. Arranque en maqueta, persona y mediodía. Materiales mates y luz simple; SSR/bloom fuera de la ruta limpia.

## Evidencia propia

- `cibeles-aerial.jpg` y `cibeles-street.jpg`: fuente escultórica simplificada, cuerpos del palacio/Banco, calzadas diferenciadas del pavimento neutral. JSON adjuntos contienen cámaras, raycasts y cero solapamientos genéricos dentro de las23 huellas reservadas. Eso no valida los edificios vecinos ni todas las colisiones.
- `retiro-aerial.jpg`: caminos OSM, agua visible y árboles del inventario municipal. `cibeles-orbit/` y `retiro-orbit/`: cuatro orientaciones por lugar. Son fotogramas separados, **no una prueba continua que cierre todo el flickering**.
- `palacio-almudena.jpg`: patios reales y siluetas de cúpula/torres; fachadas y cubiertas aún demasiado genéricas. Captura anterior al cambio de calzadas, conservada como evidencia de masas, no del suelo final.
- `hardware.json`: Chromium con ANGLE Intel Iris Xe/Mesa, `passed=true`, sin errores de página/gráficos/peticiones. Cero actores ambientales. Descarga y recarga de k3j0:6053 árboles antes/después, de ellos5979 municipales; se retira la geometría al descargar.

Suite final: **215/215**, más `git diff --check`. Muestra hardware: arranque5726ms,149 frames/3s≈49,7FPS; p95 intervalo33,4ms, máximo116,7ms durante la ruta; máximo render36,2ms.159 draws,3.548.914 triángulos y55.355.550B de atributos de geometría CPU al final. No son VRAM, percentiles estadísticos de varios dispositivos ni una comparación controlada de velocidad. Pintura y consulta de superficies siguen en main:31–79ms observados al reconstruir, fuera del coste habitual de un frame.

## Qué cambió

Se retiraron los props/árboles aleatorios NYC y el corredor/viaducto perimetral de Manhattan que cruzaba el Retiro. El fondo queda bajo el agua y la semilla usa su core, evitando100m de deck coplanar con las teselas vecinas. La cuadrícula del fondo no existe en este modo.

Banco de España, Palacio de Cibeles, Palacio Real, Teatro Real y Almudena usan masas de parcelas IDEAM ya incluidas, recortadas a huellas OSM. Banco recupera seis interiores; Palacio Real cuatro; Almudena dos. Cubiertas de cristal mapeadas permanecen cubiertas. Almudena incorpora cúpula, cubiertas piramidales y linterna a partir de partes OSM; el perfil es una aproximación simple. Cibeles conserva la huella que ancla su decoración noroeste: sustituirla por el contorno crudo cambia sus índices y rompe esa orientación.

Las ventanas de landmarks seleccionan el eje de proyección en vértices, con desempate estable y varying plano, como las fachadas secundarias. La prueba numérica recorre720 rotaciones en diagonales. Persiste ruido visual en pequeños quiebros de los contornos fuente: la comparación sin sombras no lo elimina. No atribuirlo a shadow acne ni afirmar fachada resuelta.

El deck neutral ya no representa todo el suelo como asfalto. Los corredores de calzada siguen las mismas vías de superficie que el grafo residente: se excluyen túneles, puentes sin perfil, capas no cero y accesos denegados. Anchos OSM o estimados por la política existente: **no bordillos medidos**. Uniones redondas ilustrativas, recorte al core, asfalto y marcas a distintas alturas. Las franjas usan caminos marcados OSM y se cortan en los límites de calzada, conservando fase y refugios; muestreo0,35m (tolerancia de borde<0,2m). No inventar cruces en cada intersección.

## Retiro y procedencia

Caminos OSM/Geofabrik, ODbL1.0. Se recortan a parques/cores, se resta agua y se usa ancho2,5m ilustrativo cuando falta el atributo.744 vías de camino consideradas en los cinco cores del Retiro; no se dibuja una retícula inventada.

Árboles: [Inventario municipal, Geoportal de Madrid](https://geoportal.madrid.es/IDEAM_WBGEOPORTAL/dataset.iam?id=c85742e7-d4ac-11ef-a6b2-e0d4648d893e), CC BY4.0; [servicio Arbolado Parques Históricos](https://sigma.madrid.es/hosted/rest/services/MEDIO_AMBIENTE/ARBOLADO/MapServer/8).35.293 registros consultados en polígonos Retiro,21.000 posiciones distintas tras agrupar duplicados a1cm. Se guarda ID canónico mínimo y mediana de alturas válidas. Posición cuantizada a0,1m y altura a0,25m. Copas/tamaños de símbolo son ilustrativos; altura desconocida usa un símbolo7m. Inventario sustituye los símbolos OSM dentro de su cobertura, no se superponen ambos. La atribución figura también en el pie del mapa.

Reproducción desde fuentes temporales, sin subir PBF/JSON crudos:

```sh
PYTHONPATH=/tmp/madrid-osmium python3 tools/madrid/extract-landmark-topology.py /tmp/madrid-paridad.osm.pbf /tmp/madrid-expanded-landmark-topology.json
node tools/madrid/prepare-landmark-inputs.mjs /tmp/madrid-expanded-landmark-topology.json /tmp/madrid-expanded-landmark-inputs.json
PYTHONPATH=/tmp/madrid-geometry python3 tools/madrid/build-landmark-masses.py /tmp/madrid-expanded-landmark-inputs.json js/madrid-landmark-masses.js
node tools/madrid/prepare-park-inputs.mjs /tmp/madrid-osm-features.json /tmp/madrid-park-inputs.json
PYTHONPATH=/tmp/madrid-geometry python3 tools/madrid/build-park-paths.py /tmp/madrid-park-inputs.json js/madrid-park-paths-data.js
python3 tools/madrid/query-park-tree-ids.py /tmp/madrid-park-inputs.json /tmp/madrid-retiro-tree-ids.json
python3 tools/madrid/fetch-park-trees.py /tmp/madrid-retiro-tree-ids.json /tmp/madrid-retiro-municipal-trees.json
PYTHONPATH=/tmp/madrid-geometry python3 tools/madrid/build-municipal-trees.py /tmp/madrid-retiro-municipal-trees.json /tmp/madrid-park-inputs.json js/madrid-municipal-tree-data.js
```

Extractor necesita pyosmium (`/tmp/madrid-osmium` en esta máquina); generadores Python necesitan Shapely. Hash de la descarga municipal de esta revisión:942a3ef75cb692a83282a02a894662f5e1b3a0e58ddb21684dcff6f334288e39. No esperar ese hash tras una actualización municipal.

Datos de teselas listas+blocks12.089.393B, cuatro datasets auxiliares487.801B, total12.577.194B frente al límite12.582.912B. La nueva prueba incluye ambos; quedan5718B. Es tamaño de módulos fuente, no memoria decodificada ni JS total. No aumentar el límite silenciosamente. El inventario está comprimido por ese presupuesto; el renderer decodifica puntos, pero solo monta geometría residente.

## Repetir QA

```sh
node --test tests/*.test.cjs
HARDWARE_GPU=1 node tools/madrid/measure.mjs --tiles k3j0,k3j1 --check-street-lifecycle
HARDWARE_GPU=1 node tools/madrid/inspect-scene.mjs --place cibeles --view maqueta --zoom 0.45 --wait 10000 --motion-dir /tmp/cibeles-orbit --shot /tmp/cibeles.jpg --json-out /tmp/cibeles.json
HARDWARE_GPU=1 node tools/madrid/inspect-scene.mjs --place retiro --at '1600,50,0' --view maqueta --zoom 0.7 --wait 10000 --shot /tmp/retiro.jpg --json-out /tmp/retiro.json
```

Exportar PLAYWRIGHT_MODULE y CHROME_PATH según CODEX-HANDOFF.md. GPU real y spawn de pruebas requieren permisos fuera del sandbox. No ejecutar dos QA GPU a la vez.

## Pendientes que esta revisión no cierra

Modelo arquitectónico de Cibeles y fuente todavía ilustrativos; ventanas de monumentos genéricas y quiebros visualmente sucios. Suelo de calzadas no sustituye cartografía de bordillos/plataformas reales. Faltan elementos reconocibles del Retiro, incluido el conjunto de Alfonso XII. Parques fuera del Retiro sin inventario municipal completo. Cámara/persona sigue limitada por bounds de semilla: el intento x1600 se recorta a1500,7; resolver para exploración continua de teselas. Móvil físico, paseo sostenido y flickering de toda la escena pendientes. Three CDN `@dev` sigue sin fijarse. Cobertura parcial, no toda Madrid.

Cambios revisables: modo estático6ed5dc2; masas7f59592; suelo/caminos0dc8180; inventario04c2cd5; calzadas/pintura f8e1c21; proyección f2547e9. Revertir circulación implicaría reactivar una función que el propietario ha pedido mantener apagada. El cambio de corredores se puede retirar en `madrid-road-surfaces.js`, `madrid-road-surface-geometry.js`, sus llamadas en city-grid/tile-world/main y altura/consulta de road-paint, restaurando el deck previo sin retirar inventario ni masas. La corrección de proyección afecta solo a landmarks y su prueba. Herramientas/evidencia no cambian comportamiento de producto.
