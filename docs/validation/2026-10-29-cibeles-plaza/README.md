# Cibeles: retirar pavimento sin geometría de superficie

El generador build.mjs reunía fragmentos de calles con nombre de plaza y dibujaba su rectángulo envolvente como granito a12 cm de altura. En Cibeles ocultaba unos92×89 m de calzadas. `osm-name-audit.json` conserva IDs/tags del extracto OSM/Geofabrik usado: las vías son abiertas, con highway, oneway y surface=asphalt; no describen una plataforma peatonal.

Ahora los fallback de nombre del generador llevan geometrySource=name-bounds y renderSurface=false; quedan fuera de plazasMadrid. El renderer respeta renderSurface=false y contiene una compatibilidad limitada al rectángulo histórico de Cibeles (si no tiene confirmación explícita de superficie). Las plazas con geometría real siguen renderizándose. No se regeneraron edificios ni se cambiaron alturas/datos fuente pesados.

Comparación: ../2026-10-29-cibeles/model-after.jpg antes y model-after.jpg aquí después, mismo viewport/cámara. Imagen inspeccionada sobre Intel Iris Xe: desaparece el cuadrado y vuelven a verse la calzada y la isleta central. Suite192/192; sintaxis del generador y diff check correctos. No implica que marcas, medianas, árboles o fuente estén ya terminados.

Fuente OSM: https://download.geofabrik.de/europe/spain/madrid.html, ODbL-1.0; extracto temporal /tmp/madrid-paridad.osm.pbf, SHA256 d262f1c908907f596b4d02c2064014482e1b2ffced0f2b2886ab4ef89ec06471. La auditoría es pequeña y derivada; no se añade el PBF a git.
