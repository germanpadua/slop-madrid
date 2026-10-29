# Respaldo de red residente

`27e6f10` conserva las aristas físicas de pintura y comparte la preparación de red entre el worker y una ruta de respaldo en el hilo principal. Si Worker no existe, falla al crearse/cargar o no admite el mensaje, se prepara el snapshot actual con la misma cobertura y descarte por versión. `roadStats.mode` distingue `worker` y `main-fallback`.

Prueba de navegador con el archivo madrid-road-worker.js bloqueado deliberadamente: `worker-blocked.json`, `fallbackPassed=true`, 2.884 aristas de circulación, 4.581 de pintura, 340 peatones colocados. Los dos errores de petición registrados son el bloqueo deliberado del módulo (precarga y worker). No son fallos de producción observados.

Reproducción: `HARDWARE_GPU=1 PLAYWRIGHT_MODULE=... CHROME_PATH=... node tools/madrid/debug-boot.mjs --timeout 90 --after 5000 --fail-road-worker`.

Límite: esta recuperación calcula el grafo de forma síncrona en main y puede causar pausas de cientos de milisegundos. Es una degradación funcional, no una mejora de rendimiento ni sustitución predeterminada del worker.
