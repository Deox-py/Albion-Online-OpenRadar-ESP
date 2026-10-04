# V7.3.0 de prueba — automatización y diagnóstico

**Entrega histórica sustituida por V7.3.1, sólo radar.** El usuario pidió excluir la automatización; el código de esa función y este ejecutable experimental quedaron archivados bajo `.build/backups/before-V7.3.1-radar-only`. Las instrucciones siguientes describen V7.3.0 y no corresponden a la entrega actual.

Fecha: 3 de octubre de 2026. V7.3.0 experimental compilada y comprobada. **No está aprobada por Albion y no se puede asegurar ausencia de sanciones.** Tras la nueva condición del usuario, queda pendiente elegir una entrega sólo offline o conservar esta entrega experimental aceptando su riesgo. No se ha ejecutado contra el juego.

## Alcance

La versión conserva zoom, contexto inicial de mapa y estabilidad de V7.2.1. Añade un controlador experimental de planes finitos de movimiento y clics de recolección, simulación, selección de ventana de Albion y objetivos visibles marcados. La captura de red permanece pasiva; el modo real envía entradas normales del ratón.

Las acciones `move` y `gather` representan clics sobre puntos del área cliente. No ofrecen navegación entre mapas ni buscan automáticamente recursos por tier; una espera no demuestra que el personaje llegó o recolectó. No se incorpora un detector ONNX externo sin licencia y compatibilidad comprobadas. El descifrado de posiciones de otros jugadores sigue sin un método actual validado.

## Protección de los archivos anteriores

Fuente y cinco archivos previos de dist respaldados con SHA256 real en `.build/backups/before-V7.3.0-trial-20261003-174424`. El builder permite una salida separada bajo dist y esta prueba usará `dist/pruebas/V7.3.0`. No se sustituye el EXE anterior.

## Automatización

La función se configura desde Automatización en `http://localhost:5001/automation`. Sólo controla ventanas comprobadas del proceso de Albion, está desactivada al iniciar y no recuerda autorización de ejecución real. Simulación no envía entradas. El plan tiene límites de pasos y duración y esperas cancelables.

Las pruebas de Escape, pérdida de foco, intervención manual, validación de coordenadas y aislamiento HTTP pasaron con drivers falsos. No se ejecutan clics reales durante QA ni se afirma validación en una sesión de Albion.

## Qué incorpora esta prueba

| Cambio | Función y motivo |
|---|---|
| Automatización nativa Windows | Plan de 1–100 pasos, una sola ejecución, máximo 10 minutos incluyendo cuenta atrás; clic derecho para movimiento y clic izquierdo para recolección. Evita bucles indefinidos y permite probar acciones sin dependencias nuevas. |
| Simulación y habilitación expresa | Simulación no envía entradas. El permiso real se borra al iniciar, cambiar el plan, cambiar de ventana o abandonar el panel. |
| Objetivos de pantalla | Vista previa opcional, porcentajes manuales, edición de pasos y esperas de 0,5–60 segundos. Una nueva captura descarta el plan anterior; el inicio comprueba las dimensiones contra la ventana actual. |
| Parada y concurrencia | Escape, foco perdido, minimización, cambio de tamaño, intervención manual, STOP y cierre del radar. Cada STOP invalida solicitudes de inicio antiguas; la interfaz cancela START pendiente y no espera su acuse para detener. |
| Identidad de ventana | Se comprueban nombre del ejecutable, HWND, PID y creación del proceso; se rechaza una ventana reciclada y un objetivo cubierto por otra ventana. |
| Entrada y DPI | Secuencia completa de movimiento/pulsación/liberación; recuperación de liberación ante entrada parcial. Manifest PerMonitorV2 para coordenadas de pantalla consistentes. No se eleva automáticamente el proceso. |
| Inspector de eventos | Optativo, desactivado al entrar, hasta 500 registros; JSONL solicitado por el usuario. Parámetros requieren una segunda opción y se limitan en tamaño, profundidad y frecuencia. |
| Diagnóstico de captura | Tramas truncadas, errores de decodificación y fragmentos IPv4 omitidos, visibles en Configuración → Red. No se confunden con fragmentación Photon ni se presenta un reensamblador IP incompleto. |
| Catálogos reproducibles | Actualizador fijado a commit, hashes de fuentes y salidas, bloqueo de publicación, staging y recuperación. Los cinco catálogos existentes se mantienen idénticos; el cambio se aplica a futuras actualizaciones explícitas. |
| Compilación independiente | `-OutputDirectory` permite generar una prueba bajo `dist/pruebas` conservando el EXE anterior. Verificador reutilizable para hashes, payload, recursos y versión. |

Se implementaron ideas con utilidad comprobable de los proyectos estudiados. No se ejecutaron sus bots ni se incorporaron sus modelos, binarios o código sin licencia clara. Los informes de investigación anteriores siguen describiendo qué se examinó y qué no se probó.

## Cómo abrir y probar

1. Ejecutar `dist/pruebas/V7.3.0/OpenRadar-2.3ESP_Deox.exe`. El launcher pide instalación oficial de Npcap si falta; no se redistribuye el driver.
2. Abrir `http://localhost:5001` y comprobar la interfaz de red seleccionada. El radar funciona con los datos que realmente observa; si empezó después de entrar a la zona, usar el selector de zona conocido o esperar información capturada.
3. En **Automatización**, elegir una ventana de Albion. Para una vista previa, pulsar **Capturar en 3 s**, devolver el foco al juego y luego regresar al panel. Algunos renderizadores pueden devolver imagen negra o no responder; en ese caso se informa error y se pueden usar puntos manuales.
4. Preparar inicialmente un único paso corto y pulsar **Simular plan**. Revisar tipo, porcentajes, espera y dimensiones. La simulación no mueve el personaje ni el cursor.
5. Para ejecución real, habilitar el checkbox después de revisar el plan y pulsar **Ejecutar en 3 s**. Volver al juego y mantener el foco; el radar no lo cambia por sí mismo. Los botones utilizados deben coincidir con los controles configurados en Albion.
6. Detener con **Escape** desde Albion o con **STOP** en el panel. Volver al navegador también provoca pérdida de foco y detiene la ejecución. Salir del panel envía STOP; el cierre del radar une y cancela el trabajador.

La API de automatización requiere equipo local y mismo origen también para consultar ventanas y capturas. `--lan` mantiene disponible la visualización general, pero no concede control remoto de esta función.

## Pruebas y errores corregidos

| Comprobación | Resultado verificado |
|---|---|
| Vitest | 960 pruebas, 51 archivos, aprobadas. Incluye 39 de automatización y regresiones del radar existente. |
| TypeScript y ESLint | Aprobados; el harness de navegador se incluyó en la configuración de globals correspondiente. |
| Go | Todos los paquetes con pruebas aprobados, incluidos servidor, motor, captura, parser, launcher y templates. |
| Detector de carreras | `go test -race -count=1 . ./cmd/... ./internal/... ./tools/...` aprobado. Evidencia en `.build/qa/go-race-V7.3.0.txt`. |
| Packaging | 13 grupos, con recursos reales Windows, versión, icono, manifest, DPI, restauración de staging, ZIP, hashes, firmas y salida independiente. |
| QA estática y smoke | 12 y 7 grupos aprobados. Sin `.git`, la comprobación de diff Git se omite de forma explícita. |
| Navegador del radar | PCAP anonimizado → Photon → WebSocket → UI, contexto inicial, selector, zoom, móvil, reset, limpieza HTMX y ausencia de HTTP externo: aprobado. |
| Navegador de automatización | Ventanas y PNG sintéticos, puntos manuales y por imagen, porcentajes/dimensiones, simulación, habilitación real, parada, navegación y reinicio sin permiso: aprobado. Todas las llamadas de automatización fueron interceptadas; cero entradas nativas. |
| Revisión independiente | Reprodujo dos carreras con fetch falso y confirmó sus correcciones; no dejó bloqueos confirmados en su cobertura. |

Se corrigió la posibilidad de que START llegara después de STOP al cerrar o recargar una pestaña. Una generación obligatoria vincula cada inicio al estado actual; STOP avanza esa generación incluso estando inactivo. También se eliminó la espera del acuse de START antes de emitir STOP, se limita el acuse de parada a cinco segundos y se ignoran respuestas antiguas. Se cubrieron JSON duplicado, coordenadas omitidas/no finitas, límites, dimensiones obsoletas, inserciones parciales, cierre y reinicio concurrentes.

Un recorrido del radar detectó que el clic anterior podía desplazar el centro del canvas detrás del encabezado fijo en el harness. Se corrigió la prueba mediante scroll e hit testing del destino antes de enviar la rueda, sin ampliar tiempos ni cambiar la lógica de zoom.

No se probaron clics reales, capturas de una ventana real de Albion, recolección efectiva, obstáculos, inventario lleno, combate o navegación entre mapas. Las pruebas con drivers falsos validan el controlador y sus contratos; no acreditan compatibilidad de la entrada o renderizador con una sesión concreta del juego.

## Riesgos y límites

La automatización puede infringir las reglas de Albion y causar sanción de cuenta. La [investigación](../technical/ALBION_PROJECTS_AND_AUTOMATION_RESEARCH_2026-10-03.md) contiene la respuesta oficial utilizada como fuente. No se ofrece indetectabilidad. Sin certificado disponible, el EXE se distribuirá sin firma Authenticode; metadata y hashes no garantizan aceptación de antivirus o SmartScreen.

La nueva comprobación del 3 de octubre encontró el [aviso oficial sobre bots y seguridad de cuentas, junio](https://forum.albiononline.com/index.php/Thread/223612-Bots-Bans-Account-Security-Update-June-1st-30th/), que clasifica macros/bots como automatización y radar/scanner como herramientas de ventaja injusta. Los [términos](https://albiononline.com/terms_and_conditions) contemplan sanciones y exclusión permanente por cheats o bots. La apertura directa de ambas páginas devolvió 403; el buscador proporcionó el texto indexado de esas páginas oficiales. Estas fuentes no dan autorización a OpenRadar, y la captura pasiva no debe presentarse como una garantía contra sanciones.

Con la condición estricta de evitar sanciones, esta entrega en vivo no se recomienda para abrir junto con Albion. La alternativa es una aplicación limitada a simulación/replay, sin captura en vivo ni entradas al juego, utilizada con Albion cerrado. No se promete inmunidad frente a decisiones del operador del juego.

La captura pasiva y el inspector no añaden solicitudes al servidor del juego. La ejecución real envía acciones al cliente y esas acciones pueden generar tráfico normal del juego. No se añadieron inyección, proxy, evasión, empaquetadores como UPX ni ofuscación.

La detección automática de recursos, OCR del nombre de mapa y navegación autónoma siguen pendientes de muestras y validación propias. Tampoco se afirma haber descifrado coordenadas de otros jugadores. Esta entrega contiene automatización básica de puntos seleccionados, no un recolector autónomo validado.

## Artefactos comprobados

Compilación completa: `build-logs/build-20261003-181804.log`, código de salida 0, sin omitir QA. Build UTC: `2026-10-03T21:18:48Z`. Producto: `2.3ESP_Deox-V7.3.0`; versión numérica: `2.3.0.730`.

| Archivo en dist/pruebas/V7.3.0 | Bytes | SHA-256 |
|---|---:|---|
| OpenRadar-2.3ESP_Deox.exe | 72.164.864 | `1df16693202400a4eb95f0f3d925c32a86c96ec8b7af299739060796082731a3` |
| OpenRadar-2.3ESP_Deox-direct-windows-amd64.zip | 52.796.511 | `8215a6c7749c97310a5e6b41accb191a94b2a6430d863db3ae2b2b67e267f25b` |
| OpenRadar-core.exe, dentro del ZIP | 65.918.976 | `e0c5990e3df9b75652f346996c41f1b7221662bec9e689f9e35e55bdf7ff0ce7` |

El verificador aprobó los manifests SHA-256 externos e internos y comprobó que el núcleo del ZIP coincide byte por byte con el payload del launcher. Ambos `--version` coinciden con el producto y fecha de build. Ambos contienen icono, manifest asInvoker y PerMonitorV2; ambos están **NotSigned**. El ZIP incluye núcleo, licencia, LEEME y hashes. La evidencia está en `.build/qa/release-integrity-V7.3.0.json`.

Los cinco archivos previos de dist y los cinco catálogos JSON se contrastaron con el respaldo mediante hashes, sin cambios. No se eliminaron archivos fuente; pruebas, backups y staging permanecen bajo `.build` y los logs en `build-logs`.
