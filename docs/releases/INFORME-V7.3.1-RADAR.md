# V7.3.1 de prueba — mejoras del radar

Fecha: 3 de octubre de 2026 (America/Sao_Paulo). Producto `2.3ESP_Deox-V7.3.1`, versión Windows `2.3.0.731`. **Compilación y verificación aprobadas; entrega sólo del radar, sin automatización.** No se ha ejecutado contra una sesión de Albion y no se puede garantizar ausencia de sanciones.

## Resultado solicitado

El usuario pidió conservar las mejoras del radar y excluir la automatización. Se retiraron del código activo el motor de movimiento/recolección, las funciones de entrada de Windows, la API, la captura de ventana del juego, los scripts y la página de automatización. Tampoco quedan botones, navegación o carga de módulos de esa función. La nueva entrega se genera en `dist/pruebas/V7.3.1`, separada del ejecutable anterior de `dist`.

La V7.3.0 que incluía automatización se archivó de forma reversible en `.build/backups/before-V7.3.1-radar-only/excluded/artifacts/V7.3.0`. Los archivos retirados están bajo `excluded` conservando sus rutas. Antes de modificar el código se creó `source.zip` con 4.644 archivos fuente y un manifiesto SHA-256 del respaldo y de las diez piezas de distribución existentes. La copia previa a V7.3.0 también se conserva.

## Qué incluye

| Mejora | Comportamiento y motivo |
|---|---|
| Zoom del radar | Rueda, botones y deslizador, escala de 10 a 300 %, persistencia y sincronización entre pestañas. Amplía la vista del radar; no cambia la cámara de Albion. |
| Contexto inicial de mapa | El navegador recibe la zona ya observada aunque se conecte después. Si la captura empezó sin observar la entrada a la zona, se puede elegir una zona conocida manualmente sin cambiar de mapa en el juego. El origen manual queda indicado. |
| Continuidad y estado incompleto | Avisos y reset ante desconexión o saturación de colas. La aplicación deja de presentar datos incompletos como actuales; la captura pasiva no solicita una instantánea al juego. |
| Diagnóstico de captura | Contadores de tramas truncadas, errores de decodificación y fragmentos IPv4 omitidos en Configuración → Red. Facilitan distinguir problemas de captura y de protocolo. |
| Fragmentos IPv4 | Se descartan antes de pasarlos a Photon; no se implementa un reensamblador parcial. Los contadores sólo conocen los paquetes que acepta el filtro de captura: no miden todo el tráfico de la interfaz. |
| Inspector de eventos | Desactivado por defecto, hasta 500 registros recientes y exportación JSONL solicitada. Usa el WebSocket existente; parámetros requieren una habilitación separada y tienen límites de tamaño, frecuencia y profundidad. Se limpia al salir o desactivarlo. |
| Catálogos reproducibles | Actualizador fijado a un commit SHA completo, hashes de fuentes y salidas, staging, bloqueo de publicación y recuperación ante fallo. Se conservan los cinco catálogos JSON actuales; no se descargaron datos durante estas pruebas. |
| Compilación y distribución | Salida independiente bajo `dist`, recursos Windows coherentes, icono, manifest `asInvoker`, DPI PerMonitorV2, ZIP directo del núcleo, checksums y verificador reutilizable. |

Se conserva la captura pasiva existente. Estos cambios no añaden solicitudes al servidor del juego, inyección, proxy ni modificaciones del cliente. El inspector registra una selección limitada de eventos y no sustituye una captura PCAP completa.

## Correcciones comprobables

Al quitar la ruta de automatización se descubrió que el manejador de `/` aceptaba cualquier URL desconocida y podía devolver el radar con estado 200. Se registró `/{$}` para que la raíz coincida exactamente. Las rutas eliminadas devuelven ahora 404, y las páginas existentes conservan el renderizado completo y parcial HTMX. La prueba de regresión falló con la integración anterior y pasó después de retirarla.

La navegación HTMX elimina los listeners del radar al salir y crea una sola instancia al volver. La prueba de navegador revisa que el zoom no se aplique dos veces, que el mapa reciba contexto inicial y que el reset borre la posición y las entidades anteriores.

Las actualizaciones de datos publican el manifiesto al final y conservan material de recuperación si falla un rollback. Los ensayos usan respuestas de red falsas; no alteraron los catálogos incluidos.

## Pruebas

| Comprobación | Resultado |
|---|---|
| Vitest | 921 pruebas en 48 archivos, aprobadas en la compilación nueva. |
| TypeScript y ESLint | Aprobados. |
| Go | Todos los paquetes con pruebas aprobados. |
| Carreras Go | `go test -race -count=1 . ./cmd/... ./internal/... ./tools/...` aprobado, sin reutilizar resultados de pruebas. |
| Exclusión de rutas | 24 combinaciones GET/POST y renderizado completo/HTMX de las rutas retiradas devuelven 404; las 16 variantes de las ocho páginas restantes devuelven 200. |
| Packaging | 13 grupos aprobados: staging y restauración, rutas de salida, ZIP, hashes, firmas, imports, icono, versión, manifest y DPI. |
| QA estática y smoke | 12 y 7 grupos aprobados. Se informó explícitamente que no hay `.git` para ejecutar `git diff --check`. |
| Navegador con replay | PCAP anonimizado → Photon → WebSocket → UI: mapa inicial, selección manual, zoom con rueda/botones/móvil, reset y limpieza HTMX aprobados, sin errores de JavaScript ni solicitudes HTTP externas. |
| Exclusión en navegador | Navegación sin automatización y ocho URLs de página/API/assets retirados con 404. |
| Exclusión en fuentes y binarios | Sin implementación de entrada al juego en `internal`, `cmd` o `web`; los nombres del paquete y de las funciones nativas retiradas no aparecen en los bytes del launcher o del núcleo. La regresión HTTP conserva los nombres de las rutas que exige ausentes. |
| Revisión independiente | 221 pruebas dirigidas del radar aprobadas; doce archivos de captura, inspector, catálogos, zoom, mapa y ciclo de vida coinciden con el respaldo anterior a la retirada. Sin hallazgos bloqueantes en esa cobertura. |
| Conservación | Los diez archivos de las entregas anteriores conservan sus hashes; los cinco de V7.3.0 están archivados y los cinco de `dist` permanecen en su sitio. Payload provisional y recursos de build restaurados. |

Evidencias: `build-logs/build-20261003-221742.log`, `.build/qa/go-race-V7.3.1.txt`, `.build/qa/offline-browser.json`, `.build/qa/release-integrity-V7.3.1.json` y `.build/qa/radar-only-release-V7.3.1.json`.

Estas pruebas no abrieron Albion, no enviaron entradas nativas al juego ni ejecutaron el modo normal de captura del EXE. El verificador ejecutó únicamente `--version` en ambos binarios. La ausencia de nombres de funciones en bytes complementa la revisión de fuentes y las pruebas de rutas; no equivale a una aprobación de un sistema anticheat.

## Uso

1. Ejecutar `dist/pruebas/V7.3.1/OpenRadar-2.3ESP_Deox.exe`, o extraer el ZIP directo y abrir `OpenRadar-core.exe`. Ambos necesitan Npcap; el launcher ofrece el instalador oficial si falta. No se redistribuye el driver.
2. Abrir `http://localhost:5001`; revisar la interfaz en Configuración → Red.
3. Ajustar zoom con rueda y controles. Si falta el contexto inicial, usar el selector de una zona conocida. Para una instancia dinámica se necesita su identificador observado; no se inventa.
4. Usar el inspector sólo para diagnóstico y exportar únicamente cuando haga falta. Un parámetro numérico de Photon puede contener información privada cuya semántica aún no conocemos; la redacción por nombre no elimina todo dato sensible.

Para validar la interfaz sin usar el juego, ejecutar `npm.cmd run qa:browser` con Albion cerrado. Ese recorrido usa un PCAP anonimizado y un servidor local de replay. El ejecutable normal sigue capturando tráfico en vivo; no es una aplicación exclusivamente offline.

## Límites y sanciones

No se ha validado un método actual para descifrar las coordenadas exactas de otros jugadores. Las posiciones que no conoce el radar siguen sin dibujarse. No se realizaron inyección, lectura de memoria ni cambios del cliente para obtenerlas. La herramienta observa lo que recibe; no puede recuperar datos que el servidor no envía.

No hubo una prueba contra una sesión real de Albion. Las pruebas de protocolo, UI y captura con fixtures no acreditan compatibilidad con todos los mensajes de una actualización futura del juego.

**Retirar la automatización no garantiza ausencia de sanciones.** El [aviso oficial de Albion sobre bots y seguridad de cuentas](https://forum.albiononline.com/index.php/Thread/223612-Bots-Bans-Account-Security-Update-June-1st-30th/) incluye radar/scanner entre herramientas que pueden dar una ventaja injusta. Los [términos de Albion](https://albiononline.com/terms_and_conditions) contemplan sanciones por cheats y bots. En la consulta del 3 de octubre, la apertura directa devolvió 403 y el buscador proporcionó texto indexado de ambas páginas oficiales. Ninguna fuente autoriza esta entrega. Si la condición es evitar ese riesgo, limitar el uso a pruebas offline con el juego cerrado.

El launcher y el núcleo están **NotSigned**, comprobado por el verificador: no hay un certificado disponible. Metadatos y hashes ayudan a identificar y verificar la distribución, pero no garantizan que Windows, SmartScreen o un antivirus la acepten. No se añadieron técnicas de evasión, ofuscación ni UPX.

## Artefactos

Compilación completa con QA, salida 0. Hora local: 3 de octubre, 22:18:26; build UTC: `2026-10-04T01:18:26Z`.

| Archivo en dist/pruebas/V7.3.1 | Bytes | SHA-256 |
|---|---:|---|
| OpenRadar-2.3ESP_Deox.exe | 71.875.072 | `fcb74ddefe3a2f48ff0369b5c867397b1f6a7ed3a8c5defc74af6a292c33df78` |
| OpenRadar-2.3ESP_Deox-direct-windows-amd64.zip | 52.684.041 | `e273f43995d09a177f075abcf6c76bb966fd5aec1f865ba89b10115144ee0a04` |
| OpenRadar-core.exe, dentro del ZIP | 65.629.184 | `ce6a888140506900e60ff7f84e0cd8bf8605c9df81cbe0f9eaf0af4f26333801` |

El verificador aprobó los manifests SHA-256 externos e internos y comprobó que el núcleo del ZIP coincide byte por byte con el payload del launcher. Ambos `--version` coinciden con el producto y la fecha de build. Ambos contienen icono, manifest `asInvoker` y PerMonitorV2. El ZIP incluye núcleo, licencia, LEEME y hashes. No necesita iniciar un ejecutable secundario para extraer el núcleo.

La fuente y las entregas anteriores permanecen respaldadas; `.build`, `node_modules`, `build-logs` y capturas privadas no forman parte de los archivos para compartir. El directorio actual de prueba contiene sólo EXE, ZIP y sus tres archivos de notas/checksums.

## Referencias de implementación

- [Diagnóstico experimental incorporado al radar](../technical/EXPERIMENTAL_DIAGNOSTICS_V7.3.0.md).
- [Distribución y firma Windows](../technical/WINDOWS_RELEASE.md).
- [Comparación de los ZIP adjuntos](../technical/REFERENCE_PROJECTS_REVIEW.md).
- [Investigación de proyectos Albion](../technical/ALBION_PROJECTS_AND_AUTOMATION_RESEARCH_2026-10-03.md).

Los informes anteriores se conservan como historial. Su descripción de automatización no corresponde a V7.3.1.
