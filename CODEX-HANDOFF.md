# Handoff para Codex - rama wip/merged-zone (2026-10-28 ~21:00 CET)

## Que es esta rama
Trabajo local en curso sobre feat/madrid (HEAD 3a5c2b0). feat/madrid NO se ha tocado: es la rama que publica GitHub Pages (verificado: live == HEAD byte a byte), y este prototipo no debe activarse en la web sin verificacion de arranque del mapa completo.

## Contenido
1. **Prototipo merged-zone** (js/madrid-tile-world.js, rama `globalThis.__MERGED===1`, harness `block3-tilepath.html?merged=1`): cada parcela se extruye con su contorno REAL + huecos reales en UNA geometria (paredes+tapa via grupos de material de ExtrudeGeometry; merge manual que preserva grupos). UN material de fachada pre-war TSL compartido con tinte por parcela via vertex colors (puerta `vertexTint` nueva en js/tsl-materials.js createPreWarBuildingMaterial; cacheKey lo incluye; solo mamposteria, ventanas no tenidas). Tapas planas con material propio vertex-colored. Paletas MZ_TINTS/MZ_CAPS derivadas de referencias tiny-madrid, etiquetadas ILUSTRATIVAS (IDEAM solo trae {ring,h,holes}; NO hay datos reales de color).
2. **Fix de datos de huecos** (tools/madrid/classify-rings.mjs + tools/madrid/build.mjs + tests): emision de `holes` en tiles. tile-k3j0.js reconstruido CON huecos (106 parcelas). Las OTRAS 10 teselas NO tienen huecos todavia: regenerar con `tiles.mjs build --no-fetch <id>` tras revisar la decision de publicar el fix.
3. **Harness de verificacion visual**: block3-tilepath.html (ruta real createTileWorld/addTile, WebGPURenderer forceWebGL). Datos: block3.json (29 parcelas), block4.json (204), block5.json (tile k3j0 completo, 1160). Params: ?merged=1, ?data=<file>, ?neutral=1 (luz neutra), ?debug=outline (overlay magenta=contorno fuente a h+0.3, cian=huecos), ?tintprobe=1 (paredes azules), ?perfskip=1 (control de overhead, 0 renders).
4. Otros: js/madrid-footprint.js (slicer de huecos), madrid-adjacency.js (partyWallRuns clamp d<=0.5), cambios menores en madrid-roofs.js e index.html, viewer-cibeles.html, block*.html harnesses anteriores.

## Verificado (con evidencia)
- 17/17 suites cjs verdes (incl. footprint-holes, classify-rings); tile-world + tsl parsean.
- Censo por malla (geometria x instancias): merged block4 = 5508 tris emitidos / 2 mallas (zona 5496 + deck 12; zona lleva 2 grupos de material = 2 draw calls en pase principal) vs baseline strips = 7907 / 19 mallas. calls 38=38 (renderer.info, incluye pases de sombra).
- Topologia: probe azul + overlay validan contornos/huecos/alturas en block4 y en k3j0 completo (cobertura visual muestreada; NO prueba universal ni multipart). 0 anillos degenerados en 26344 parcelas de 11 teselas; 0 huecos fuera de anillo.
- Ruta de vertexTint efectiva (probe azul mueve todas las fachadas).

## INCONCLUSO - no afirmar
- **Rendimiento**: metodo = estimacion wall-clock del bucle temporizado (mtime perfstart->perf /10, gl.finish; overhead medido 3.65ms). Numeros n=1/2 misma config: block4 merged 12.33/13.11/13.11ms vs baseline 4.92 (merged MAS LENTO a 204 parcelas); block3 merged 5.10 sin baseline nueva. Pares antiguos block3 (0.79 vs 1.67) eran otra config de GL, no comparables. Sospechos si se confirma: coste de fragmento de la fachada TSL en mas area de pared real, sombras de una malla grande de 2 grupos, sopa de vertices no indexada.
- **Arranque del mapa completo**: NO verificado. En sandbox (software-GL) el boot de la app completa muere por limite de ~110s de wall-clock tras construir el mundo + iniciar streaming de teselas; sin banderas cae en 'No available adapters' (WebGPU). Ruta de captura propia de la app: index.html?capture&debug&at=x,z,heading,y,modo&shot. En el navegador en la nube (GPU real) la app desplegada SI arranca con ?capture=1&debug=1.

## Pendiente (orden sugerido)
1. Verificar arranque del mapa completo (entorno con GPU o navegador en nube) ANTES de cualquier publicacion.
2. Validez multipart + otras teselas (solo k3j0 probada).
3. Perf: repetir pares misma-config n=3 en block3 y block4; aislar fragmento/vertice/sombra si merged sigue mas lento.
4. Decision de publicar el fix de datos de huecos (reconstruir las 10 teselas restantes).
5. Opcional: suavizar respuesta en sombra de la fachada TSL SOLO en la rama merged (puerta vertexTint), experimento acotado.
6. Hitos de variacion en merged-zone (de uno en uno, inspeccion de pixeles): tejados a cuatro aguas sobre tapas, banda de locales en planta baja, paridad de medianeras.

## Reglas vigentes
- Sin publicar en la web ni gasto externo sin autorizacion expresa.
- Colores SIEMPRE etiquetados ilustrativos hasta tener fuente de datos real.
- La baseline por defecto no se toca: todo el prototipo va detras de ?merged=1.
- tools/data/madrid/ (67MB de fuentes OSM/i3s en crudo) NO se sube al repo.
- Medir, no inferir: censo por malla (geometria x instancias), nombrar entorno y n en cada cifra.
