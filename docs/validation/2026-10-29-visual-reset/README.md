# Revisión crítica: calidad visual insuficiente

El propietario rechaza el acabado actual: flickering, fondo cuadriculado visible, grandes masas blancas, Cibeles irreconocible/fuente ausente, césped y Retiro incorrectos. No considerar el trabajo comparable con TinyWarsaw ni aprobado visualmente.

Se abrió https://tinywarsaw.app/ en Chromium/Iris Xe, viewport1280×720. La vista seguía mostrando Building view(138) al capturar; no es un benchmark de carga. Se inspeccionó la composición visible: masas articuladas, patios y cubiertas, estructura de parques con caminos y dosel, trazado urbano legible y paleta unificada. La captura de referencia queda solo en /tmp/tinywarsaw-reference.png.

Cambios concretos de estabilidad: el fondo de zonas pendientes era explícitamente una cuadrícula de topografía; se sustituye por fondo neutro. El plano de agua de60000m heredado del puerto se deja fuera del modo Madrid. El césped tenía ruido de microhojas sin filtrado y franjas de siega artificiales; ahora usa manchas amplias y desvanece el detalle fino con derivadas de pantalla.

194/194 pruebas. Revisión de órbita en cuatro orientaciones con GPU real; se conservan primera y última. El césped pierde la retícula visible. Esto NO establece que todo flickering esté resuelto: no se hizo análisis temporal por píxel ni recorrido completo. El nuevo --motion-dir del inspector facilita capturas de órbita, pero capturas discretas no prueban ausencia de parpadeo.

El estado sigue visualmente deficiente. Las masas de Banco de España/Palacio Cibeles y el terreno continúan dominando negativamente. El centro genérico no reproduce las articulaciones de las fuentes: el Banco tiene49 fragmentos de parcelas ya disponibles con33 alturas diferentes y el renderer los sustituye por una sola extrusión de36,1m sobre la huella exterior. Debe reconstruirse desde volumen/topología con procedencia, conservando patios cubiertos/abiertos; no corregirlo solo con color.

Nuevo criterio: usar Cibeles y entorno como muestra pequeña exigente de arquitectura/terreno antes de ampliar superficie o población. Revisión contra referencias en movimiento, calle y aéreo; pruebas técnicas son condición necesaria, no aprobación estética.
