# Dirección de fachadas Madrid (borrador de trabajo, 2026-10-28)

Pregunta del usuario: "¿las fachadas se parecen a Madrid?" Respuesta honesta: todavía no.

**DIRECCIÓN DEL USUARIO (2026-10-28, prioritaria):** estilo más SIMPLE, tipo Warsaw, modificado
levemente para parecer Madrid - no realismo de fachada ornamentado. Concretamente: fachadas
limpias y planas (color plano + sombreado sutil, sin retícula de ventanas ruidosa), con rasgos
madrileños seleccionados (paleta, tejados de teja, banda de planta baja y línea de cornisa como
máximo). Antes de cualquier despliegue general: comparación mismo bloque actual vs propuesto
para que el usuario decida. La propuesta ornamental de más abajo queda SUPERSEDED como referencia
de fuentes, no como plan.

Este documento fija por qué y hacia dónde va el trabajo de fachadas. Es una propuesta de dirección,
no una decisión aprobada; cualquier prototipo se valida con renders contra referencias antes de
integrarse.


## Estado actual (verificado en código)

- Las 4 fachadas "Madrid" (`MADRID_FACADE_OPTS`, js/madrid-tiles.js:223) se generan TODAS con el
  mismo generador pre-war de Nueva York (`FACADE_DEFS[0][0]`, js/madrid-tile-world.js:133) solo
  cambiando paleta, tamaño de hueco y altura de planta. La estructura de la fachada (retícula
  uniforme de ventanas) es neoyorquina.
- El arquetipo se elige por hash por parcela: mismo barrio mezcla caliza, ladrillo, ocre y salmón
  sin criterio urbano.
- No hay composición vertical: sin planta baja comercial diferenciada, sin piso principal, sin
  cornisa ni coronación, sin ático retranqueado.
- Los interiores de corrala (los patios que acabamos de abrir en k3j0) muestran la misma retícula
  de ventanas que la calle; la corrala real tiene galerías/corredores volados hacia el patio.
- Las paletas en sí sí son madrileñas (caliza, ladrillo visto, ocre y salmón tipo Tiny-Madrid);
  el problema es la ESTRUCTURA, no el color.

## Qué hace que una fachada se lea como Madrid (fuentes)

Corrala / casco antiguo (Lavapiés, La Latina, Embajadores):
- Ladrillo visto, madera y hierro forjado; balcones de hierro; 4-5 plantas.
- El rasgo distintivo es interior: galerías corridas (corredores) voladas al patio, sostenidas por
  columnas de hierro o madera.
- Fuente: IFEMA, "Corralas de Madrid: guía de historia y visitas"
  https://www.ifema.es/visita-madrid/historia/corralas-de-madrid-guia-historia-visitas
- Tipología casa de corredor (citada, pendiente de lectura):
  https://oa.upm.es/14326/1/JAIME_SANTA__CRUZ_ASTORQUI_PARTE_I.pdf

Ensanche / zonas nobles (Salamanca, Cortes, ejes como Gran Vía):
- Orden y simetría en huecos y balcones; molduras en ventanas; frisos longitudinales a ambos lados
  de los balcones del piso principal; rejería cuidada.
- Coronación de tres tipos: cornisa lisa, balaustrada o alero; el muro continuo como fachada
  representativa de la ciudad.
- Fuentes: UPM, "Análisis constructivo y dimensional de fachadas de la Gran Vía madrileña"
  (http://oa.upm.es/29704) y esmadrid.com, Palacio López-Dóriga
  (https://www.esmadrid.com/informacion-turistica/palacio-lopez-doriga)
- Ornamentación del Ensanche 1860-1929 (citada, pendiente):
  https://dialnet.unirioja.es/servlet/tesis?codigo=191267
- Miradores acristalados como rasgo burgués (misma fuente IFEMA).

## Dirección SUPERSEDED (ornamental; se conserva solo como referencia de fuentes)

1. Composición vertical en el generador: bandas de planta baja (huecos mayores, paño distinto),
   piso principal (balcones con rejería marcada, molduras), pisos corrientes (retícula más
   sencilla), coronación (línea de cornisa; balaustrada o alero según arquetipo) y ático
   retranqueado cuando la altura IDEAM lo permita. Esto rompe la retícula uniforme, que es lo que
   delata la fachada actual.
2. Arquetipo por datos, no por hash: casco antiguo (ladrillo/revoco, 4-5 plantas), Ensanche
   (caliza, simetría, 6-7 plantas), ejes monumentales (piedra, coronación ornamental). Selección
   por tesela/altura/datos disponibles; la altura IDEAM (`h`) ya la tenemos por parcela.
3. Interiores de corrala: galerías voladas hacia el patio (bandas horizontales de corredor) en las
   caras interiores de los híbridos fp+holes. Es EL gesto visual madrileño en los patios que ya
   hemos abierto; visible en maqueta aérea.
4. Cubiertas: teja árabe (actual) para casco; pizarra/mansarda más oscura para Ensanche.
5. Mantener las paletas actuales (ya madrileñas) y la puerta del experimento desactivada por
   defecto hasta validación visual.

## Plan de prototipo

- Extender el generador de fachada con parámetros de bandas (baja/principal/corriente/coronación)
  en una rama de trabajo, sin tocar el comportamiento por defecto.
- Validar en el harness (block3-tilepath.html con datos reales de k3j0) contra fotos de referencia
  de corralas y Ensanche; inspección de píxeles antes de commit.
- Después: asignación de arquetipos y fachadas interiores de corrala. Cada paso con commit
  revisable en wip/madrid-experience.

## Plan activo (Warsaw-simple, 2026-10-28)

1. Prototipo de material de fachada simple: color plano por parcela (paletas Madrid actuales),
   sombreado muy sutil de plantas SIN huecos dibujados, banda de planta baja y línea de cornisa
   como únicos rasgos; cubiertas como hoy (teja en casco, pizarra oscura en Ensanche si aporta).
2. Comparación A/B en el harness sobre el MISMO bloque real de k3j0 (block3-tilepath.html,
   ?data=block17.json o manzana 315): render actual vs propuesto, misma cámara, para enseñársela
   al usuario ANTES de cualquier integración. Sin commit de integración hasta su OK.
3. Si el usuario aprueba: arquetipo por datos (casco/Ensanche/ejes) con la misma economía visual;
   galerías de corrala solo si se leen limpias a esta escala; nunca por hash ruidoso.
4. Referencia de simplicidad: tiny-warsaw (una malla por zona, atlas 1024x512, vertex colors,
   medianeras = retranqueo + banda oscurecida, no supresión de huecos). Es guía de economía
   visual, no plantilla a copiar.
