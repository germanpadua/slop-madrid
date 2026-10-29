# Palacio de Cibeles: corrección inicial de fidelidad

`overlap-before.json` mide35 masas genéricas dentro del polígono fuente con el generador anterior (override de módulo mediante --buildings-file, sin alterar checkout). `overlap-after.json` y `model-after.json` miden0 con la reserva poligonal. Las huellas que solo tocan borde no se consideran invasión. La reserva solo está activada para este palacio, no para otros monumentos.

Comparación calle: `../2026-10-29-hardware-circulation/street-cibeles.jpg` antes, `street-after.jpg` después, misma posición/rumbo/viewport. Capturas inspeccionadas sobre Intel Iris Xe: desaparecen edificios genéricos superpuestos; torres/entrada miran hacia el noroeste, galerías visibles, coronaciones sin grandes conos y reloj bajo la galería superior. La revisión intermedia reveló un tambor suspendido: corregido conectándolo a cubierta28 m y comprobado de nuevo. Fuente documental y aproximaciones: ../2026-10-29-cibeles-architecture.md.

`model-after.jpg` fue inspeccionada también. **No aprueba el conjunto:** revela grandes cubiertas simplificadas sin patios y una plaza rectangular que cubre calzadas. Esto motiva la siguiente ronda centrada en geometría/procedencia de plaza, fuente y edificios. La fuente aún es una superficie plana. La torre central y demás detalles son simbólicos, no un levantamiento arquitectónico.

Pruebas al cerrar esta corrección:192/192, sintaxis de harness y git diff --check correctos. No se ha publicado.
