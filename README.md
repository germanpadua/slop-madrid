# Slop Madrid

Recreación explorable del centro de Madrid con Three.js, WebGPURenderer y materiales TSL, basada en [Slop New York](https://mrdoob.github.io/slop-newyork/). Permite recorrer las calles y observarlas desde una maqueta aérea. El objetivo acordado está en [PRODUCT.md](PRODUCT.md); el estado del prototipo anterior, en [CODEX-HANDOFF.md](CODEX-HANDOFF.md).

## Arranque local

Desde la raíz del repositorio:

```sh
python3 -m http.server 8080
```

Abre `http://localhost:8080`. Las dependencias Three.js y las fuentes se descargan de Internet. WebGL2 es el backend predeterminado validado; `?webgpu=1` activa el backend experimental y `?webgl=1` fuerza WebGL2; `?debug=1` expone los diagnósticos. La cámara **Maqueta de Madrid** está en el selector de cámaras: arrastra para girar y usa rueda o pellizco para acercarte. El mapa (`M`) permite cambiar de zona.

## Verificación

```sh
node --test tests/*.test.cjs
```

Para el navegador se requiere Playwright y Chromium instalados:

```sh
PLAYWRIGHT_MODULE=/ruta/a/playwright/index.mjs CHROME_PATH=/ruta/a/chrome WEBGL=1 \
  node tools/madrid/measure.mjs --boot-only
```

Opcionales: `HARDWARE_GPU=1` solicita ANGLE OpenGL con GPU local; el informe registra el dispositivo realmente usado. `VIEWS_DIR=/tmp/madrid-vistas` captura calle y maqueta en escritorio y maqueta con entrada táctil emulada. `VERBOSE=1` muestra la consola y `SCREENSHOT=/tmp/madrid.png` guarda una captura. Sin `--boot-only` el verificador prueba también streaming. `--stress` añade una fase de precarga de 5 km para detectar bloqueos al incorporar muchas teselas. Una pérdida de contexto, un error de validación gráfica, una tesela fallida o ausencia de fotogramas produce un resultado fallido. Los FPS de SwiftShader son diagnósticos de software y no una medida de GPU real.

## Datos y licencias

Código bajo [MIT](LICENSE). Consulta [MADRID.md](MADRID.md) para fuentes y generación geográfica. Los colores y detalles procedurales son ilustrativos. Los datos fuente pesados de Madrid con permisos de redistribución pendientes quedan fuera del repositorio. No se deben regenerar las teselas restantes sin disponer de esas fuentes y revisar sus permisos.

## Preparación de teselas

Las huellas y medianeras se analizan en un worker de módulo antes de montar las mallas. El modo `?debug=1` registra tiempos de importación, preparación, montaje y muestras acotadas de latencia de frames. El informe del verificador incluye estos datos y comprueba que las fachadas de las teselas comparten materiales con el centro.

Para comparar los algoritmos puros con la versión anterior, incluyendo igualdad exacta de resultados y tres pares de mediciones:

```sh
node tools/madrid/benchmark-preparation.mjs 77921de k3j0
```

Para medir puntos reconocibles a pie o desde la maqueta (cada punto se visita por teletransporte y se observa tres segundos):

```sh
HARDWARE_GPU=1 GL_PROFILE=1 PLAYWRIGHT_MODULE=/ruta/a/playwright/index.mjs CHROME_PATH=/ruta/a/chrome \
  node tools/madrid/measure.mjs --places sol,cibeles,alcala
# Añade --aerial para observar esos puntos desde la maqueta.
```

`GL_PROFILE=1` instrumenta llamadas WebGL que ocupan más de 2 ms en el hilo principal. Permite localizar esperas de programas y subidas de buffers; no mide por sí solo el tiempo de ejecución de la GPU. Las sondas de shaders se calientan durante el arranque y quedan ocultas después, conservando las cachés sin dibujarse en cada frame.

El experimento `?detail=distance` simplifica solo los materiales de fachadas lejanas, conserva la geometría y restaura el material al acercarse. No está activo por defecto: la comparación no demostró una mejora consistente de FPS. Puede medirse con `DISTANCE_DETAIL=1` o con `DETAIL_COMPARE=1` para alternar detalle completo y lejano en la misma escena y cámara.
