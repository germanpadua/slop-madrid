# Continuar Madrid desde wip/madrid-experience

Retoma **`wip/madrid-experience`**, no `main` ni `feat/madrid`. El último commit de implementación de este traspaso es **`1700d56`**; el commit posterior contiene esta documentación. La web publicada no se ha actualizado. Consulta `git status` y `git log` antes de actuar.

## Objetivo y criterio de trabajo

Crear una experiencia de Madrid comparable a [Tiny Warsaw](https://tinywarsaw.app/), sus [notas de motor](https://tinywarsaw.app/preview/engine/) y [Slop New York](https://mrdoob.github.io/slop-newyork/): exploración razonablemente fiel a pie y maqueta aérea, con monumentos y barrios reconocibles. El usuario permite edificios secundarios genéricos para rendir mejor y pide trabajo autónomo.

El objetivo completo sigue pendiente:

1. Eliminar bloqueos del streaming, separando importación, preparación, montaje, compilación y dibujo.
2. Unificar materiales, balcones y cubiertas entre centro y teselas.
3. Niveles lejanos con menos geometría/dibujos, conservando patios cercanos y monumentos.
4. Completar los patios pendientes al disponer de fuentes y permisos, y revisar monumentos.
5. Validar rutas a pie/aéreas, escritorio/móvil, y publicar cuando sea estable.

No declarar el objetivo completo por pasar tests o una ruta corta. No publicar todavía: faltan calidad visual, cobertura y validación. El usuario autoriza commits y push de trabajo; los cambios de esta sesión se suben a esta rama, sin hacer merge a las ramas publicadas.

## Arranque y pruebas

Es una web estática, sin package.json ni paso de build:

```sh
python3 -m http.server 8080
node --test tests/*.test.cjs
node tools/madrid/benchmark-preparation.mjs 77921de k3j0
```

Abre `http://localhost:8080`. Three.js y fuentes requieren Internet. Three.js sigue apuntando a `@dev`: revalida su comportamiento, no asumas que el CDN es inmutable.

Estado final comprobado: **160/160 pruebas CJS pasan**, y `git diff --check` y `node --check tools/madrid/measure.mjs` pasan. En el sandbox, los subprocesos de Node pueden fallar por permisos; ejecutar con los permisos adecuados antes de confundirlo con un error de sintaxis.

### Navegador con GPU

El entorno local SÍ tiene GPU cuando el navegador se ejecuta fuera del sandbox: Intel Iris Xe (RPL-P), Mesa 26.0.8, ANGLE OpenGL. La ausencia de `/dev/dri` dentro del sandbox NO demuestra ausencia de GPU. Configuración usada (verificar rutas en otra máquina):

```sh
export PLAYWRIGHT_MODULE=/home/germanpadua/.npm/_npx/ad9a3fdbcad992c6/node_modules/playwright-core/index.mjs
export CHROME_PATH=/home/germanpadua/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome
HARDWARE_GPU=1 GL_PROFILE=1 node tools/madrid/measure.mjs --tiles k3j1,k4j1,k4j2 --stress
HARDWARE_GPU=1 GL_PROFILE=1 node tools/madrid/measure.mjs --places sol,cibeles,alcala
HARDWARE_GPU=1 GL_PROFILE=1 node tools/madrid/measure.mjs --places sol,cibeles,alcala --aerial
HARDWARE_GPU=1 GEOMETRY_DETAIL=1 DETAIL_COMPARE=1 node tools/madrid/measure.mjs --tiles k4j1,k4j2 --aerial --zoom 2
```

`VIEWS_DIR=/tmp/madrid-review` captura escritorio y móvil táctil emulado. `SCREENSHOT=/tmp/madrid.png` guarda una captura. `VERBOSE=1` muestra consola. El JSON registra el dispositivo realmente usado. `GL_PROFILE=1` registra llamadas WebGL que bloquean CPU >2 ms; NO es un temporizador de ejecución GPU. Las capturas de móvil son emulación en la GPU del escritorio.

`--places` teletransporta al peatón a destinos configurados y observa 3 s; NO recorre las calles entre ellos. Revisa también si las coordenadas/nombres heredados de destinos son adecuados: el destino `alcala` está junto al cuartel, no en la puerta misma.

## Estado de implementación

| Área | Incorporado | Límite pendiente |
|---|---|---|
| Backend | WebGL2 predeterminado; HUD muestra el backend | `?webgpu=1` experimental: errores de buffers observados |
| Streaming | Reservas para importaciones pendientes y descarte tras abandonar zona | Importar/preparar no equivale a tener la zona visible |
| CPU | Índice espacial de medianeras y límites de huellas precalculados | Mantener igualdad topológica y no bloquear al montar |
| Worker | Huellas, medianeras y transformaciones exactas de tejados | Sin Worker existe la ruta síncrona anterior |
| Shaders | Sondas pequeñas calentadas al arrancar y ocultas tras primer frame | No volver a compilar concurrentemente con MRT sin validar |
| Madrid | Retirados 15.447 edificios ficticios de NYC y escaleras exteriores; centro y teselas comparten 4 fachadas Madrid | Cubiertas y masas del centro aún difieren de teselas; otros restos de NYC como taxi amarillo |
| Maqueta | Cámara con giro/zoom; controles móviles revisados | El centro procedural domina muchas vistas y aún no tiene proxy geométrico |

Se ensayó compileAsync por tesela durante el renderizado: redujo pausas pero produjo GL_INVALID_OPERATION por salidas MRT. Se retiró. No reintroducirlo basándose solo en latencia. La copia del experimento en `/tmp/madrid-precompile-experiment/` es temporal, no requisito para continuar.

## Experimentos optativos: NO activados por defecto

- `?detail=distance`: cambia solo materiales lejanos; conserva geometría. No mostró mejora consistente de FPS.
- `?detail=geometry`: el worker fusiona las tiras de parcelas, elimina caras inferiores y paredes internas y transfiere buffers indexados. Una malla sustituye las cuatro fachadas de una tesela al alejarse. Mantiene tejados, híbridos con patios y monumentos. Añade memoria y todavía no optimiza el centro.
- Ambos usan histéresis: lejos >1.000 m, volver a detalle <850 m. Los materiales son ilustrativos.
- El prototipo anterior merged-zone sigue separado, en los harnesses como `block3-tilepath.html?merged=1`; no está activado en la app normal.

### Último cambio que necesita revisión visual

En k3j0 se detectaron **17 parcelas con fp+holes** cuyas medianeras activaban una caja AABB que tapaba el patio. `exposedPartyWallSides` evita ese split tanto cerca como lejos. Las 160 pruebas pasan tras corregirlo, incluida área de tapa, perímetro del patio y orientación de triángulos. **Los informes/capturas GPU de geometría lejana son anteriores a esta última guardia: repetir la revisión visual antes de darla por validada.**

## Evidencia y siguientes acciones

`docs/validation/*.json` conserva resultados; `MADRID-PROGRESS.md` contiene la cronología y límites. Los `/tmp/*.json` y PNG citados allí pueden desaparecer: no son necesarios para reproducir los comandos.

- La preparación inicial llegó a bloquear ~15 s en CPU. Con worker, cubiertas preparadas y sondas de shaders, el montaje más costoso observado pasó a ~38 ms; último estrés predeterminado: intervalo máximo ~117 ms, p95 ~33,4 ms, render máximo ~30,5 ms. Muestras exploratorias, no garantía universal.
- Proxy k3j0: 31.452 → 23.860 triángulos en la cohorte representada; ~2 MB adicionales. k4j2: 125.256 → 92.870; ~7,8 MB adicionales. Se conservan las mallas cercanas para volver sin reconstruir.
- En cámara oriental, dos pares completo/lejos dieron 90/100/90/102 frames por ~2 s; en cámara del centro no hubo mejora consistente. No activar el proxy por defecto con esa sola muestra.

Orden recomendado al retomar:

1. Confirmar visualmente los 17 patios corregidos, incluido acercarse/alejarse, y comprobar que no aparecen edificios ausentes al cambiar LOD.
2. Medir memoria, triángulos y draw calls reales con cámara sobre teselas; comparar varias muestras con caché y cámara controladas.
3. Diseñar el proxy del centro (26.216 parcelas en 488 grupos). No enviar de golpe todo al worker ni asumir que basta optimizar las teselas periféricas.
4. Unificar cubiertas y revisar siluetas de monumentos y restos de Nueva York; validar rutas continuas y horarios, además de teletransportes.
5. Completar patios/datos y publicar solo tras superar la validación del conjunto.

## Datos y publicación

`tools/data/madrid/` NO está disponible en este checkout: se excluyeron fuentes pesadas (~67 MB) y hay permisos de redistribución pendientes. No afirmar que se pueden reconstruir todas las teselas ni subir esos datos sin resolverlo. Solo k3j0 se reconstruyó con huecos; faltan los huecos de otras 10 teselas. Los colores no provienen de IDEAM: son ilustrativos.

No se ha hecho merge ni publicación de la web. Conserva la rama de trabajo y no uses force-push. El traspaso previo se conserva en el historial: `git show 1532896:CODEX-HANDOFF.md`.
