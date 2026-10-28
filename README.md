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
