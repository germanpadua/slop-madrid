# Cielo y pintura: diagnóstico sobre GPU real

El raycast de la sesión anterior alcanzaba el `SkyMesh` de `lighting.js`, una caja atmosférica de 200 km de lado. No identifica un edificio perdido ni agua de Nueva York. Se ha nombrado `MadridAtmosphericSky` para que futuras inspecciones lo distingan. No se ha eliminado ni cambiado su shader.

`software-before.jpg/json` conserva el defecto de bandas de la sesión anterior. `hardware-before.jpg/json` reproduce la misma cámara de Gran Vía (28, -374, rumbo -1.68) con el código de pintura pendiente y ANGLE sobre **Intel Iris Xe**: cielo limpio, pintura visible, 201 frames durante los diez segundos posteriores al teletransporte (incluye asentamiento/carga, no benchmark estable). Captura inspeccionada.

El defecto visual del renderizado por software permanece sin causa interna confirmada. No afirmar soporte idéntico en todos los adaptadores ni borrar el cielo basándose solo en su distancia. `/dev/dri` está ausente en el sandbox pero disponible al ejecutar Chromium con acceso autorizado al hardware local.

Reproducción: `HARDWARE_GPU=1 PLAYWRIGHT_MODULE=... CHROME_PATH=... node tools/madrid/inspect-scene.mjs --place granvia --at '28,-374,-1.68' --wait 10000 --ndc '0,0.6;-0.4,0.75' --shot /tmp/granvia.jpg --json-out /tmp/granvia.json`. El inspector ahora espera todo el intervalo solicitado y registra el renderer efectivo.
