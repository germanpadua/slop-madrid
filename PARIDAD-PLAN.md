# Plan de paridad — 2026-10-29

Objetivo abierto: acercar Madrid al acabado de TinyWarsaw, manteniendo datos oficiales, flat shading y simulación heredada de NYC. No push/deploy/merge. Rama de trabajo local feat/paridad, base f40e310. Las diferencias entre checkout y misión están en MADRID-PARIDAD.md.

| Bloque / orden | Estado | Criterio de cierre |
|---|---|---|
| 0. Investigación directa | Hecho con límites | NYC y módulos TinyWarsaw descargados, despliegue contrastado; faltan recorridos visuales de referentes |
| E0. Instrumentación | Hecho al validar harness | Contar compilaciones desde navegación y bytes de atributos únicos de escena; JSON reproducible |
| A. Fachadas y patios | Pendiente | Falta WIP referido madrid-facades.js; revisar alternativa local y patios k3j0, 3 manzanas con cámaras idénticas y veredicto individual |
| B. Vida fuera de semilla | Pendiente | Altas/bajas grafo y agentes, pruebas borde/descarga, paseo continuo sin teletransporte |
| C. Calle con fuente | Pendiente | Inventario árboles/señales OSM, instanciado por tesela, densidad y memoria antes/después |
| E1. LOD centro/móvil | Pendiente | Conservar patios/siluetas, bajar draws/tris, repetir misma cámara; FPS real del propietario |
| D. Cobertura | Bloqueado por fuentes/base divergentes | Reconciliar 19/85 frente a 12 ready locales y recuperar fuentes autorizadas antes de generar las restantes |

Orden: primero diagnóstico visual y contadores para evitar añadir detalle a ciegas; después agentes y detalle de calle para vida; después LOD del centro antes de multiplicar superficie. TinyWarsaw sugiere también terreno adaptativo, geometría precalculada, niveles regionales y revelado temprano: todavía no implementados aquí. No subir presupuesto sin medición.

## E0 — mediciones y reproducción

Comando desde el repositorio real (subcarpeta slop-madrid del workspace):

```sh
PLAYWRIGHT_MODULE=/home/germanpadua/.npm/_npx/ad9a3fdbcad992c6/node_modules/playwright-core/index.mjs CHROME_PATH=/home/germanpadua/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome HARDWARE_GPU=1 GL_PROFILE=1 node tools/madrid/measure.mjs --boot-only
```

Referencia inicial: passed=true, WebGL2/Mesa 26.0.8, arranque 18508 ms, 711 draws, 4289107 triángulos; muestra de ~3 s: 36,54 FPS, p95 intervalo 33,4 ms, máximo 150 ms, render máximo 35,8 ms. Es una muestra desktop, no garantía ni benchmark móvil. No hay errores gráficos. El conjunto residente puede cambiar mientras se mide: snapshot inicial 1447308 bytes, posterior streaming 2186040 bytes. No confundir con buffers.

Presupuesto sin cambios: 12582912 bytes de módulos, máximo 12 teselas; excluye buffers, texturas y overhead JS. Geometría medida por el nuevo campo `geometryStorage.attributeBytes`: suma payload de arrays únicos de atributos/índices/morph/instancias de toda escena, también oculta. No es VRAM ni memoria total del proceso. `glTotalsSinceNavigation`: llamadas y tiempo CPU de compilación/link/upload/dibujo desde navegación; sin GL_PROFILE es null; el perfil anterior solo recogía llamadas lentas >2 ms durante ruta. No mide duración GPU.

Bytes/entrada ready manifest: fase2 738732; k0j-1 287174; k0j3 450984; k1j-1 340592; k2j-1 495213; k2j4 424999; k3j-1 229533; k3j0 202659; k3j1 121670; k4j0 370804; k4j1 399280; k4j2 693314. No son los tamaños de las 19 teselas de la otra línea.

Rollback E0: revertir instrumentación de tools/madrid/measure.mjs y sus informes; no cambia app ni fuentes. No se han modificado ni debilitado aserciones.

## Checklist del propietario por bloque

- [ ] Investigación: abrir https://tinywarsaw.app/preview/ y https://mrdoob.github.io/slop-newyork/; comparar calle y vista aérea, especialmente continuidad de detalle.
- [ ] A: servir `python3 -m http.server 8080`, abrir http://localhost:8080/?debug=1; Sol/Cibeles y maqueta k3j0. Ver balcones, zócalos y patios sin tapas; acercarse/alejarse. Pendiente capturas por manzana.
- [ ] B: en esa URL, paseo continuo desde semilla a k3j0/k3j1: deberían circular coches y cruzar peatones sin cortes ni agentes sobre edificios. Función aún pendiente.
- [ ] C: árboles/señales alineados con fuente; ninguna duplicación al volver a tesela. Pendiente.
- [ ] E: misma ruta en móvil físico; informar GPU/dispositivo, FPS y pausas. No se ha elevado presupuesto ni activado proxy experimental.
- [ ] D: mapa continuo de almendra sin huecos fuera de cobertura. Pendiente datos.
- [ ] Publicado https://germanpadua.github.io/slop-madrid/ no contiene este trabajo; inspeccionarlo no valida la rama local.


## Cierre de esta sesión

E0 validado: segundo arranque passed=true, 17244 ms; 72583390 bytes de atributos CPU (69,22 MiB), 4808 geometrías y 10267 arrays únicos. 199 compileShader, 109 linkProgram, 5484 bufferData. Consulta getProgramParameter: 3328,1 ms acumulados, máximo 931,9 ms; bufferData máximo 294 ms. Estos tiempos no son GPU timers. 711 draws, 4288613 triángulos; pequeñas diferencias de triángulos por simulación viva. No se atribuye la diferencia 18,5→17,2 s a mejora de rendimiento: solo cambió la instrumentación, son muestras únicas.

Evidencia persistente: tools/madrid/measurements/2026-10-29-{baseline,instrumented}.json y 2026-10-29-sol.png. La captura corresponde al primer arranque. No se alteró el render entre ambos. Suite final 160/160, cero fallos; node --check y git diff --check correctos. No se ejecutaron A/B/C/D/E1. El objetivo general permanece pendiente.

## A0 — distinguir revoco y ladrillo (hecho)

Exploración Chromium real con teclado: paseo de ~35 m desde Sol, después maqueta y viewport 390×844. Sin pageerrors. Defecto observado: la retícula de ladrillo NYC se aplicaba también a caliza/revoco; ahora la opción uniforme brickwork conserva juntas en la paleta roja y las elimina de los otros tres acabados. Ambos caminos ya comparten estas opciones. Paletas ilustrativas, no clasificación material por parcela.

Evidencia en docs/validation/2026-10-29-revoco/: before/after, móvil, paseo y medición. Veredicto local Sol/Preciados: superficies claras más legibles; ladrillo conserva su textura; pendiente revisión por manzana y patios. 160/160 tests, detector sin hallazgos, harness passed=true sin errores gráficos. Atributos idénticos: 72583390 bytes, 711 draws. Arranque 20490 ms en esta muestra; no afirmar mejora de FPS. Rollback: brickwork en tsl-materials y opciones Madrid.

Checklist A0: http://localhost:8080/?debug=1, caminar desde Sol hacia Preciados; las fachadas claras deben ser lisas y la roja conservar juntas. Confirmar lo mismo en móvil. La maqueta revela un defecto siguiente: tejados del centro limitados al radio de detalle 560 m.

Adquisición de árboles OSM: endpoint principal devuelve 406; dos espejos agotaron timeout sin datos. No se añadieron árboles inventados. Reintentar con extracto PBF o endpoint disponible antes de ampliar vegetación.
