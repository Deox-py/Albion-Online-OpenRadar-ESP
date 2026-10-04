# Documentación de OpenRadar V7.3.2

Estas fuentes corresponden al radar en español V7.3.2, sin automatización. Los informes anteriores y las notas del upstream se conservan como historial; sus rutas de trabajo, cifras de QA y binarios describen sesiones anteriores. Los logs, capturas privadas y archivos de `.build/` no forman parte del repositorio público.

## Para empezar

| Documento | Contenido |
| --- | --- |
| [README principal](../README.md) | Funciones, límites, compilación y uso en Windows |
| [Guía de desarrollo](dev/DEV_GUIDE.md) | Preparar herramientas, QA y recorrido del código |
| [Distribución Windows](technical/WINDOWS_RELEASE.md) | Salida provisional, hashes, metadatos y firma opcional |
| [Informe V7.3.2](releases/INFORME-V7.3.2-COFRES.md) | Cofres, filtros neutros, estado bruto, cifrado y validación histórica |
| [Integración GitHub V7.3.2](releases/INTEGRACION-GITHUB-V7.3.2.md) | Organización pública, CI y verificaciones de este árbol de fuentes |
| [Reglas de entrega](../AGENTS.md) | Alcance del radar y organización local de dos EXE |

## Referencias técnicas

| Documento | Tema |
| --- | --- |
| [Diagnósticos e inspector](technical/EXPERIMENTAL_DIAGNOSTICS_V7.3.0.md) | Funciones del radar conservadas en V7.3.2 y procedencia de catálogos |
| [Jugadores](technical/PLAYERS.md) | Lista, equipamiento, alertas y exclusiones |
| [Posiciones y MITM](technical/PLAYER_POSITIONS_MITM.md) | Referencia histórica; no implementa un descifrador actual |
| [Recursos](technical/HARVEST_EVENTS.md) | Recursos estáticos/vivos y resolución de tier |
| [Mists](technical/MISTS_DETECTION.md) | Portales, jaulas y detección de Nieblas |
| [Interfaces de captura](technical/CAPTURE_INTERFACES.md) | Gestor de interfaces y configuración de red |
| [Logs](technical/LOGGING.md) | Diagnóstico y grabación PCAP solicitada por el usuario |
| [Códigos Protocol18](technical/PROTOCOL18_OBSERVED_CODES.md) | Códigos observados y conteos del corpus |
| [Campos Protocol18](technical/PROTOCOL18_PARAM_LAYOUTS.md) | Layouts de parámetros observados |
| [Comparación DEATHEYE](technical/DEATHEYE_ANALYSIS.md) | Arquitectura de una referencia anterior |
| [ZIP de referencia](technical/REFERENCE_PROJECTS_REVIEW.md) | Inspección estática de las copias recibidas |
| [Radares públicos](technical/INTERNET_RADARS_REVIEW_2026-10-03.md) | Revisión fechada de fuentes públicas y sus límites |
| [AlbionOnline-ex](technical/ALBIONONLINE_EX_ADDITIONAL_REVIEW.md) | Diferencia entre anuncios, fuentes disponibles y paquetes binarios |

## Historial conservado

| Versión o documento | Alcance histórico |
| --- | --- |
| [V7.3.1](releases/INFORME-V7.3.1-RADAR.md) | Retirada de automatización y mejoras del radar |
| [V7.3.0](releases/INFORME-V7.3.0-PRUEBA.md) | Experimento anterior excluido de estas fuentes |
| [V7.2.1](releases/INFORME-V7.2.1.md) | Zoom, contexto de mapa y compilación anterior |
| [V7.2.0](releases/INFORME-V7.2.0.md) | Estabilidad, captura, parser y revisión inicial |
| [Notas Deox](history/deox/README-2.3ESP_Deox.md) | Cambios y QA anteriores |
| [README upstream anterior](history/upstream/README-before-V7.2.md) | Documentación recibida del proyecto original |
| [Roadmap upstream](project/TODO.md) | Observaciones anteriores y pendientes de validación |

Las notas `RELEASE_2.x.md` pertenecen al upstream y mantienen sus fechas y atribuciones: [2.2.3](releases/RELEASE_2.2.3.md), [2.2.2](releases/RELEASE_2.2.2.md), [2.2.1](releases/RELEASE_2.2.1.md), [2.2.0](releases/RELEASE_2.2.0.md), [2.1.0](releases/RELEASE_2.1.0.md) y [2.0.0](releases/RELEASE_2.0.0.md). No describen la publicación de binarios de este fork.
