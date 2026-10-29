# Circulación con Iris Xe, 29 de octubre

Esta pasada confirma hardware mediante `glRenderer`: ANGLE Intel Iris Xe, no llvmpipe. Incluye pintura física completa, corrección de orientación de peatones al remapear y retirada del collider elevado de la fuente plana. Se ejecutó antes de la corrección arquitectónica del Palacio de Cibeles.

Resultado: 199–200 coches y 334–340 peatones colocados; cero rutas obsoletas, cero posiciones longitudinales inválidas y cero carriles que sobresalen de su anchura en todas las muestras. Se retiran seis teselas sin nodos retenidos dentro de sus núcleos. Cero pageerrors/errores gráficos registrados. Estos contadores comprueban consistencia, no fidelidad arquitectónica ni necesidad de esa población.

Al inicio: 4.581 aristas físicas de pintura frente a 2.884 de routing. Swaps observados: 4,3–7,4 ms de preparación main (consultas, decode y lookup); el tiempo de regenerar pintura y migrar agentes es adicional. Worker 174–415 ms ida/vuelta en estas muestras. Arranque 9.951 ms en una sola muestra; no atribuir mejora frente a pasadas con software o caché distinta.

Se inspeccionaron `street-cibeles.jpg` y la captura separada de Gran Vía en ../2026-10-29-sky/. La captura de Cibeles muestra el déficit de fidelidad que motiva la siguiente corrección: silueta genérica, torres mal orientadas y masas genéricas superpuestas. No se presenta como acabado aprobado.

El recorrido usa **teletransportes**, no un paseo continuo ni móvil físico. `check-circulation.mjs` admite ahora HARDWARE_GPU=1 y registra el adaptador. Se añadieron criterios de salida fallida para inconsistencias; el JSON de esta primera pasada se generó antes de añadir su campo `passed`.
