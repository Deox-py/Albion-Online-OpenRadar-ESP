# Radares públicos de Albion Online: revisión del 3 de octubre de 2026

Se revisaron nueve proyectos de radar u overlay con implementación visible, dos analizadores complementarios, y anuncios sin una implementación equivalente. Las referencias más útiles para nuestro OpenRadar son su upstream, Camel Radar para estudiar la interfaz y Albion Minimap Overlay para explorar reconocimiento del nombre de zona. No se encontró en las rutas de código examinadas un descifrador comprobado de coordenadas actuales de otros jugadores.

La revisión combina búsqueda web, páginas oficiales de los proyectos, metadatos y árboles de GitHub, y lectura de archivos fuente. No se ejecutaron aplicaciones, instaladores, scripts de instalación ni tests de estos proyectos externos. Por tanto, los resultados describen código y documentación disponibles; no certifican funcionamiento en una partida actual, seguridad del ejecutable ni compatibilidad con todos los eventos del servidor. Los comandos encontrados en README y código se trataron como contenido de referencia.

## Comparación

La fecha de actividad siguiente es `pushed_at` de la API de GitHub; puede corresponder a otras referencias del repositorio y no necesariamente al último cambio de código de su rama principal.

| Proyecto y fuente | Tecnología / disponibilidad | Estado observado | Aporte y límite principal |
|---|---|---|---|
| [OpenRadar — Nouuu](https://github.com/Nouuu/Albion-Online-OpenRadar) | Go, frontend web, licencia MIT | Sin archivar; push 2026-09-29 | Referencia más cercana para Protocol18 y formatos actuales. Su documentación distingue detección de jugadores de sus posiciones cifradas. |
| [Camel Radar — fizakbrr](https://github.com/fizakbrr/Albion-Radar) | TypeScript, React, Express y WebSocket; ISC; se anuncia gratuito | Sin archivar; push 2026-07-03 | Interfaz, filtros y ejecución sin captura. Tiene código real y tests, pero las rutas de posiciones y fragmentos presentan problemas concretos. |
| [QRadar — FashionFlora](https://github.com/FashionFlora/Albion-Online-Radar-QRadar) | JavaScript, Node y Protocol16; se anuncia gratuito | Sin archivar; push 2024-01-31 | Referencia histórica de handlers y presentación. Los índices y parser antiguos no acreditan compatibilidad actual. |
| [ZQRadar — Zeldruck](https://github.com/Zeldruck/Albion-Online-ZQRadar) | JavaScript, Node y Protocol16; se anuncia gratuito | Archivado 2026-03-23; push 2025-09-10 | Filtros y selección de adaptador; registra jugadores en `(0,0)`. El procedimiento publicado para la release incluye autenticación por Discord. |
| [AlbionRadar — raidenblackout](https://github.com/raidenblackout/AlbionRadar) | C# / .NET 8, Npcap y overlay; GPL-3.0 | Archivado 2026-09-09; push 2025-06-12 | Organización de entidades y overlay. Varios manejadores importantes de jugadores están vacíos. |
| [Holo — Macsimka/Albion-radar](https://github.com/Macsimka/Albion-radar) | C# y Overlay.NET; README declara GPL-3.0 | Archivado 2025-02-07; push 2024-09-14 | Referencia de ventana superpuesta. Consume parámetros de posiciones de formatos históricos. |
| [AO-Radar — rafalfigura](https://github.com/rafalfigura/AO-Radar) | C#, WinForms y Photon; GPL-3.0 | Push 2021-02-19; README advierte que dejó de funcionar | Referencia histórica de renderizado y entidades, con escaso valor para el protocolo actual. |
| [Albion Minimap Overlay — ph5x5](https://github.com/ph5x5/albion-minimap-overlay) | Python, captura de pantalla, Tesseract OCR y datos de mapas | Push 2023-05-23; commit principal revisado 2022-05-31 | Puede inspirar identificación del mapa por su nombre visible. Presenta nodos obtenidos de una base de mapas, sin posiciones de jugadores en vivo. |
| [DEATHEYE 2PC — W4RPWISH](https://github.com/W4RPWISH/AlbionRadar-DEATHEYE_2pc) | C#, WPF y handlers de entidades; README declara MIT | Sin archivar; push 2025-01-07 | Referencia adicional encontrada al investigar cifrado. En las rutas examinadas lee floats directamente y fija la posición de aparición en cero. |

No se encontró un archivo de licencia en los árboles principales revisados de QRadar, ZQRadar, Holo o Albion Minimap Overlay. Los dos primeros declaran ISC en `package.json`; Holo declara GPL-3.0 en README. Se consignan estas declaraciones por separado de las licencias detectadas en archivos. Esta revisión no determina permisos de reutilización de todos sus componentes o assets.

## OpenRadar upstream: revisar la beta, además de la última estable

La API devuelve **2.2.3** como última release estable, publicada el 14 de agosto de 2026. La lista reciente también contiene **2.2.4-beta1**, publicada el 4 de septiembre como prerelease. El README informa que Dragonfire del 31 de agosto rompió la detección en 2.2.3 y atribuye la recuperación a esa beta. Es una declaración del mantenedor, sin prueba de partida realizada en esta revisión. [Release estable](https://github.com/Nouuu/Albion-Online-OpenRadar/releases/tag/2.2.3), [beta](https://github.com/Nouuu/Albion-Online-OpenRadar/releases/tag/2.2.4-beta1), [aviso del proyecto](https://github.com/Nouuu/Albion-Online-OpenRadar#openradar).

Esto justifica comprobar commits y releases de compatibilidad antes de usar automáticamente el enlace `releases/latest`. La numeración local V7.2.1 / 2.3ESP_Deox pertenece a nuestra distribución y no debe compararse como una secuencia de versiones del upstream.

## Camel Radar: aporta ideas, pero también fallos verificables

Tiene implementación real de servidor, interfaz, parsers Protocol16/18 y tests. Su [package.json](https://github.com/fizakbrr/Albion-Radar/blob/1ae6659aea7e5ba3aed053395f9333f6ade7c43e/package.json) declara la captura nativa `cap` como opcional. El [servidor](https://github.com/fizakbrr/Albion-Radar/blob/1ae6659aea7e5ba3aed053395f9333f6ade7c43e/server/index.ts) permite abrir la interfaz sin captura y muestra causas de fallo al cargar o abrir el adaptador. Ese modo por sí solo no prueba detección de entidades reales.

**Posición desconocida convertida en cero.** `handleNewPlayerEvent` obtiene una posición opcional y envía valores `undefined` a `addPlayer` cuando no existe. Si no hay una posición previa, el constructor `Player` aplica sus valores predeterminados `0,0`. El dibujo sólo rechaza valores no finitos: cero supera ese filtro. Por inspección, un jugador nuevo sin coordenadas puede acabar representado como si tuviera posición válida. La existencia de una lista para jugadores sin posición no corrige esa ruta. [Handler, líneas 1–18, 156–177 y 200–223](https://github.com/fizakbrr/Albion-Radar/blob/1ae6659aea7e5ba3aed053395f9333f6ade7c43e/scripts/Handlers/PlayersHandler.ts), [dibujo, líneas 99–139](https://github.com/fizakbrr/Albion-Radar/blob/1ae6659aea7e5ba3aed053395f9333f6ade7c43e/scripts/Drawings/PlayersDrawing.ts).

**Leer floats no equivale a descifrar.** `applyAlbionCompatibilityFields` lee dos floats little-endian del bloque de movimiento, en offsets 9 y 13, y los expone como parámetros 4 y 5. No realiza descifrado en esa función. El test correspondiente construye un buffer y escribe floats conocidos en esos offsets: verifica esa lectura sintética, sin demostrar recuperación de coordenadas cifradas de una sesión real. [Deserializer, líneas 412–418](https://github.com/fizakbrr/Albion-Radar/blob/1ae6659aea7e5ba3aed053395f9333f6ade7c43e/scripts/classes/Protocol18Deserializer.ts), [test, líneas 215–243](https://github.com/fizakbrr/Albion-Radar/blob/1ae6659aea7e5ba3aed053395f9333f6ade7c43e/tests/app.test.ts).

**Ensamblado insuficientemente aislado.** La clave de fragmentos contiene canal y secuencia, sin identidad de flujo, peer o challenge. Termina por cantidad de partes **o** suma de bytes, sin validar cobertura de intervalos y solapamientos. El límite de tamaño por mensaje y la caducidad existen, pero no se observa un máximo global de secuencias pendientes en este parser. Esto permite colisiones entre sesiones o completar buffers con huecos; son posibilidades deducidas del código, sin explotación ejecutada. [Parser, líneas 29–68](https://github.com/fizakbrr/Albion-Radar/blob/1ae6659aea7e5ba3aed053395f9333f6ade7c43e/scripts/classes/PhotonPacketParser.ts).

Nuestro [parser local](../../internal/photon/packet.go) ya distingue flujo, peer, challenge, canal y secuencia, limita las secuencias pendientes y rechaza metadatos inconsistentes, solapamientos y huecos. Reemplazarlo por el de Camel perdería esos controles. La utilidad de Camel está principalmente en estudiar su presentación y sus mensajes de diagnóstico.

## QRadar y ZQRadar: antecedentes conocidos, sin solución nueva de coordenadas

La lectura de sus ramas públicas confirma los hallazgos de los ZIP: QRadar obtiene una matriz desde `Parameters[13]`; ZQRadar comenta la lectura de posición y llama a `addPlayer` con cero en ambos ejes. Las funciones y etiquetas de jugador no implican coordenadas actuales válidas. [QRadar, líneas 111–120](https://github.com/FashionFlora/Albion-Online-Radar-QRadar/blob/bcda38edfa5c55bec6279a1a40aa11bc74a2d4c5/scripts/Handlers/PlayersHandler.js), [ZQRadar, líneas 128–152](https://github.com/Zeldruck/Albion-Online-ZQRadar/blob/ccadcda29085d817c9c89ce6615c8543480d21d3/scripts/Handlers/PlayersHandler.js).

Sus parsers Protocol16 y supuestos históricos de parámetros requieren adaptación y fixtures propios. Se mantienen como referencias de UI y ciclo de entidades. La [revisión previa de los ZIP](REFERENCE_PROJECTS_REVIEW.md) documenta también ausencia de fragmentación en sus PhotonCommand y problemas del broadcast por navegador.

## Alternativas C#: separar estructura de funcionalidad terminada

En **raidenblackout/AlbionRadar**, `HandleNewCharacter`, las actualizaciones de salud, equipamiento, montura y `HandlePlayerJoiningMap` contienen comentarios de implementación, sin lógica. `Remove` devuelve `true` sin eliminar un jugador. La ruta implementada de movimiento obtiene una matriz del parámetro 1 para el jugador principal; no demuestra seguimiento completo de otros jugadores. [PlayersHandler, líneas 47–88 y 105–145](https://github.com/raidenblackout/AlbionRadar/blob/aef37b1403be43a80d83953af232ca15a044c9b9/AlbionDataHandlersNET8/Handlers/PlayersHandler/PlayersHandler.cs).

**Holo** tiene más lógica explícita de jugadores en el archivo examinado, pero consume posiciones desde el parámetro 14 y movimientos desde los parámetros 4 y 5. Es evidencia de un contrato de eventos esperado, sin un descifrador moderno en esas rutas. [PacketHandler, líneas 322–352](https://github.com/Macsimka/Albion-radar/blob/4d2cc55ae3fc30e25a8b23a80b6cd01cf99eed9d/Holo/Networking/PacketHandler.cs).

**AO-Radar** utiliza una matriz del parámetro 13 para posiciones de aparición. Su README advierte expresamente que ya no funciona y menciona Albion 1.12.365. Resulta útil para estudiar una ventana transparente o entidades por ID, sin justificar portar su parser a producción. [Código, líneas 344–346](https://github.com/rafalfigura/AO-Radar/blob/d11a50d9214519eef3257490070730c357841bff/AlbionRadaro/PacketHandler.cs), [README](https://github.com/rafalfigura/AO-Radar).

## OCR: idea pertinente para el mapa al iniciar

**Albion Minimap Overlay** captura una región de pantalla, reconoce el nombre del mapa con Tesseract y obtiene nodos desde AlbionOnline2D, con caché local. El código confirma ese flujo. Su información de nodos no acredita que haya un recurso disponible en ese instante ni que un jugador esté en una ubicación. [Descripción](https://github.com/ph5x5/albion-minimap-overlay#how-does-it-work), [captura/OCR y datos, líneas 235–322](https://github.com/ph5x5/albion-minimap-overlay/blob/08971749ba2156e62a462d66937491ebf8cc46ef/albion-minimap-overlay.py).

Como propuesta para nuestro problema de inicio, se podría reconocer **sólo el nombre visible de la zona**, resolverlo contra la base local y presentarlo como sugerencia con su origen y confianza. Harían falta controles para idioma, escala, resolución, lecturas ambiguas y cambios de mapa. No permite identificar por sí solo una instancia dinámica, recuperar un Join perdido o ampliar el alcance de los paquetes. Esta es una propuesta derivada de la revisión, todavía sin implementar ni medir.

## Investigación adicional: cifrado y herramientas de diagnóstico

La [documentación técnica del upstream](https://github.com/Nouuu/Albion-Online-OpenRadar/blob/69a76de885152492390a904c64fd4c1a7c241c50/docs/technical/PLAYER_POSITIONS_MITM.md) describe una capa XOR para posiciones, cuya clave se distribuye dentro de mensajes Photon cifrados. También atribuye a una versión histórica de DEATHEYE una arquitectura con Cryptonite. Es una explicación del mantenedor, fechada en agosto; no demuestra por sí sola una implementación funcional en octubre. La frase de esa página sobre cifrado de todo el tráfico no debe generalizarse: nuestro parser y fixtures también procesan mensajes legibles.

El enlace histórico a `pxlbit228/albion-radar-deatheye-2pc` devolvió 404. Se localizó una copia pública diferente: **W4RPWISH/AlbionRadar-DEATHEYE_2pc**. En su `MoveEvent` se leen floats mediante `BitConverter.ToSingle` desde offsets fijos; no hay descifrado en ese constructor. `NewCharacterEvent` comenta la lectura de aparición y asigna `Vector2.Zero`. Esa copia no acredita la cadena histórica completa de recuperación de claves. [Movimiento, líneas 18–38](https://github.com/W4RPWISH/AlbionRadar-DEATHEYE_2pc/blob/8126af0a4eab98496a286c87ce68df353390b985/Radar/Packets/Handlers/MoveEvent.cs), [aparición, líneas 25–26](https://github.com/W4RPWISH/AlbionRadar-DEATHEYE_2pc/blob/8126af0a4eab98496a286c87ce68df353390b985/Radar/Packets/Handlers/NewCharacterEvent.cs). El README declara MIT, pero la API no detecta licencia y no se encontró un archivo LICENSE en el árbol examinado.

Dos herramientas adicionales pueden ayudar a validar eventos y errores; no se cuentan como radares que dibujen jugadores:

| Proyecto | Evidencia y posible utilidad | Límite de la revisión |
|---|---|---|
| [Albion Lens](https://github.com/cantalupo555/albion-lens) | Go, Protocol18, modo de descubrimiento y estadísticas; GPL-3.0. Push 2026-09-25. | Su parser omite explícitamente paquetes y mensajes cifrados, en líneas 160–168 y 273–278. Puede inspirar diagnósticos, sin aportar descifrado en esas rutas. [Código](https://github.com/cantalupo555/albion-lens/blob/3e4998c5a4edde3a6c0aa7e679c2132c18f8700e/pkg/photon/parser.go). |
| [AlbionPacketExplorer](https://github.com/LuluStudioX/AlbionPacketExplorer) | C# / Avalonia, MIT; push 2026-09-07. Documenta filtros, comparación de campos, correlación de respuestas y captura/replay en JSON por línea. | Se verificaron árbol, metadatos y documentación. No se auditó aquí toda su capa PhotonWire ni se ejecutó la aplicación; su descripción de decodificación no prueba descifrado de posiciones. |

Para acreditar coordenadas reales harían falta el formato de la versión objetivo, material de clave válido y comparación con posiciones conocidas en capturas autorizadas, incluyendo cambios de sesión. Obtener números finitos, dibujar puntos o pasar tests con buffers fabricados no satisface esa validación.

## Resultados excluidos de la selección principal

**AlbionOnline-ex** sigue sin aportar la automatización anunciada: el `main.cpp` público examinado contiene únicamente tres comandos de Git. El [archivo](https://github.com/Ghostpuoscillators/AlbionOnline-ex/blob/main/main.cpp) y la [revisión adicional del ZIP](ALBIONONLINE_EX_ADDITIONAL_REVIEW.md) sustentan esta conclusión. No se cuenta como una implementación adicional de radar.

**albion-radar.com** publica una oferta comercial con suscripciones; la mención a opciones gratuitas aparece también como comparación. No se acreditó una edición gratuita verificable con fuente equivalente, por lo que no se incluye entre los proyectos públicos analizados. [Página comercial](https://albion-radar.com/).

Las copias de README, resultados SEO y forks sin un aporte técnico comprobado no se contaron como radares independientes. La búsqueda no es un inventario exhaustivo de todos los proyectos existentes.

## Qué priorizaría en nuestra siguiente mejora

1. **Compatibilidad:** comparar cambios concretos del upstream con fixtures y layouts locales; conservar el parser y las colas endurecidas de V7.2.1.
2. **Identificación de zona:** evaluar OCR local opcional para sugerir el mapa visible cuando no se capturó el ingreso. Mantener separados nombre de zona, identidad de instancia e imagen de fondo.
3. **Usabilidad:** estudiar la organización visual de Camel y mejorar la búsqueda/agrupación de ajustes existentes, con estados claros de captura, mapa y datos incompletos. No requiere migrar el proyecto completo a React.
4. **Entidades:** mantener explícita la posición desconocida; una detección de jugador puede aparecer en la lista aunque no tenga coordenadas comprobadas.
5. **Validación:** cada incorporación de eventos necesita tipos, longitudes y muestras verificables. Los tests con floats fabricados o índices antiguos no acreditan compatibilidad con tráfico cifrado actual.

Estas prioridades son propuestas técnicas. En esta investigación sólo se añadió este informe; no se modificó ni recompiló la aplicación. La distribución local continúa siendo la [V7.2.1 ya verificada](../releases/INFORME-V7.2.1.md).

## Revisiones exactas consultadas

| Repositorio | Rama / commit usado para leer código |
|---|---|
| Nouuu/Albion-Online-OpenRadar | `main`: `69a76de885152492390a904c64fd4c1a7c241c50`; releases estables y beta verificadas por API |
| fizakbrr/Albion-Radar | `main`: `1ae6659aea7e5ba3aed053395f9333f6ade7c43e` |
| FashionFlora/Albion-Online-Radar-QRadar | `main`: `bcda38edfa5c55bec6279a1a40aa11bc74a2d4c5` |
| Zeldruck/Albion-Online-ZQRadar | `main`: `ccadcda29085d817c9c89ce6615c8543480d21d3` |
| raidenblackout/AlbionRadar | `main`: `aef37b1403be43a80d83953af232ca15a044c9b9` |
| Macsimka/Albion-radar | `master`: `4d2cc55ae3fc30e25a8b23a80b6cd01cf99eed9d` |
| rafalfigura/AO-Radar | `master`: `d11a50d9214519eef3257490070730c357841bff` |
| ph5x5/albion-minimap-overlay | `master`: `08971749ba2156e62a462d66937491ebf8cc46ef` |
| W4RPWISH/AlbionRadar-DEATHEYE_2pc | `main`: `8126af0a4eab98496a286c87ce68df353390b985` |
| cantalupo555/albion-lens | `master`: `3e4998c5a4edde3a6c0aa7e679c2132c18f8700e` |
| LuluStudioX/AlbionPacketExplorer | `main`: `faab74d7c70b0de78210be2f17e70573551405c6`; árbol y documentación |

Los commits identifican las versiones examinadas y permiten volver a consultar los archivos citados. No constituyen una certificación de sus binarios ni una prueba de ejecución en vivo.
