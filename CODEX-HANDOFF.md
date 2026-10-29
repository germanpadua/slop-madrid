# Madrid — estado vigente, 29 de octubre de2026

Rama **feat/paridad**, trabajo local sin push/deploy/merge. Revisar `git status --short` y últimos commits. Historial anterior: `git show 04c2cd5:CODEX-HANDOFF.md`. Este documento sustituye sus descripciones ya obsoletas (fuente plana, actores activos, patios sin extraer).

## Instrucción vigente del propietario

Continuar autónomamente hacia una ciudad reconocible a pie y como maqueta con calidad de TinyWarsaw. **Coches, autobuses y peatones ambientales desactivados hasta alcanzar ese estilo/calidad.** Edificios limpios/simples, iluminación simple, fidelidad de calles, masas, monumentos y parques por encima de ambientación. Se autoriza delegación, también a modelos más ligeros. No reactivar poblaciones ni tomar tests verdes como aceptación visual. El objetivo sigue incompleto.

## Implementado en esta ronda

- `6ed5dc2`: arranque persona+maqueta+mediodía; tráfico/highway desactivados sin asignar geometría; red y pintura siguen funcionando. Street-details devuelve vacío en Madrid: fuera props NYC y plantación inventada. Materiales mates, luz neutra, sin SSR/bloom en ruta limpia.
- `7f59592`: masas reales de parcelas existentes recortadas a OSM para Banco, Cibeles, Palacio Real, Teatro Real y Almudena. Relaciones/patios preservados; cubiertas de cristal registradas se mantienen. Almudena con cúpula/torres/linterna de partes OSM. Fuente de Cibeles representada con tres vasos, carro, dos leones y diosa: símbolo low-poly, no escaneo. Huella Cibeles conservada para anclar decoración noroeste.
- `0dc8180`: fondo bajo agua, core de semilla sin100m de solape, retirada carretera/viaducto litoral de Manhattan que cruzaba Retiro. Caminos peatonales OSM recortados a Retiro/core/agua, anchos sin fuente ilustrativos2,5m.
- `04c2cd5`:21.000 posiciones municipales distintas de árboles Retiro, IDs/alturas y atribución CC BY4.0, sustituyen símbolos OSM dentro de cobertura. Instancias montadas/retiradas con teselas. Copas ilustrativas, no medición municipal.
- `f2547e9`: corrección de proyección de fachadas de landmarks: eje calculado en vértices, desempate estable de diagonales, varying plano. Prueba720 orientaciones. Persisten quiebros/ruido de ventanas de los contornos complejos; sin sombras también aparecen. No se demostró shadow acne ni se ha cerrado el flickering global.
- `f8e1c21`: suelo posterior: deck neutral y corredores de calzada separados, desde vías OSM de superficie con la misma política del grafo. Fuera túneles, capas no cero y puentes sin perfil. Anchos de fuente o estimados, no bordillos levantados. Pasos de cebra recortados a calzada, manteniendo fase y refugios; sin cruces automáticos por intersección.

Evidencia vigente y reproducción: `docs/validation/2026-10-29-static-style/README.md`. Mirar las capturas y las cuatro orientaciones de Cibeles/Retiro antes de evaluar acabado. Palacio/Almudena aún demasiado genéricos; el palacio de Cibeles necesita revisión de proporciones, galerías y remates. No afirmar paridad.

## Verificado y límites

**215/215** pruebas; diff limpio. Hardware real **Intel Iris Xe**, no inferido: adaptador ANGLE/Mesa registrado en hardware.json. Arranque5726ms,49,7FPS en muestra3s,159draws/3,55Mtriángulos. Ruta de teletransportes: p95intervalo33,4ms, máximo116,7ms; máximo render36,2ms. Sin errores de página/gráficos/peticiones. Pintura sigue en main y reconstrucciones31–79ms observadas. Cero coches/buses/peatones ambientales. k3j0 descarga/recarga:6053 símbolos antes/después,5979 municipales; geometría retirada al descargar. No móvil físico ni benchmark comparativo controlado.

Datos: listas+blocks12.089.393B y auxiliares487.801B =12.577.194B de módulos fuente. Límite12MiB=12.582.912B, quedan5718B. Nueva prueba de presupuesto incluye cruces, masas, caminos e inventario además del manifiesto. No aumentar límite silenciosamente. Tamaño fuente no equivale a heap/VRAM. Datos originales pesados no añadidos.

## Siguientes tareas concretas

1. Revisión arquitectónica de Cibeles y fuente a pie/aéreo frente a referencias oficiales: proporciones/siluetas y ventanas. No volver a poner un único bloque blanco ni tapar el problema con detalles aleatorios.
2. Contornos/fachadas de Banco, Palacio Real/Almudena: ventanas genéricas en quiebros pequeños siguen feas. Conservar patios y alturas fuente al simplificar. Captura Palacio/Almudena documenta el problema.
3. Bordillos/plazas/isletas fuente y control de marcas. Corredores actuales mejoran lectura, pero sus anchos estimados no son geometría exacta de calle. Retiro: conjunto Alfonso XII, otros hitos y jardines reconocibles; no más árboles aleatorios para rellenar.
4. Exploración continua fuera de semilla: `controllers.js` usa ISLAND_BOUNDS/getIslandBoundsAtZ del rectángulo semilla. El intento x1600 queda en1500,7. Revisar contra cores listos, sin permitir caer en agua ni huecos. Teletransportes del harness no prueban caminar cruces de tesela.
5. Verificar movimiento continuo, estabilidad de sombras/superficies y móvil físico. Fijar Three `@dev` para reproducibilidad. No ampliar cobertura ni reactivar ambientación antes de calidad visual.

## Herramientas

Web estática, sin package.json/build:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
node --test tests/*.test.cjs
export PLAYWRIGHT_MODULE=/home/germanpadua/.npm/_npx/ad9a3fdbcad992c6/node_modules/playwright-core/index.mjs
export CHROME_PATH=/home/germanpadua/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome
HARDWARE_GPU=1 node tools/madrid/measure.mjs --tiles k3j0,k3j1 --check-street-lifecycle
HARDWARE_GPU=1 node tools/madrid/inspect-scene.mjs --place cibeles --view maqueta --zoom 0.45 --wait 10000 --shot /tmp/cibeles.jpg --json-out /tmp/cibeles.json
```

GPU y spawn de tests requieren ejecución autorizada fuera del sandbox. Una QA GPU a la vez. Inspector: `--motion-dir`, `--no-shadows`, `--at 'x,z,heading'`, `--buildings-file`. No-shadows sirve para aislar causas, no es modo de producto.

Fuentes temporales si sigue esta máquina: PBF `/tmp/madrid-paridad.osm.pbf`, OSM features `/tmp/madrid-osm-features.json`, pyosmium `/tmp/madrid-osmium`, Shapely `/tmp/madrid-geometry`, topología/inputs `/tmp/madrid-expanded-landmark-*.json`, parques `/tmp/madrid-park-inputs.json`, inventario `/tmp/madrid-retiro-municipal-trees.json`. Reproducción/licencias/hashes en evidencia. No subir fuentes pesadas ni fotografías ajenas con derechos pendientes.

Commits revisables locales; sin publicar. Mantener el árbol limpio al cerrar una unidad y documentar las limitaciones visuales. La solicitud es llegar al nivel, no declarar completo este prototipo.
