# Informe de mejoras — OpenRadar 2.3ESP_Deox V7.2.0

Fecha de revisión: 3 de octubre de 2026. Proyecto local recibido como carpeta de fuentes, sin historial `.git`. Se revisó también el repositorio original y los cinco ZIP proporcionados. La implementación conserva la captura pasiva y la interfaz en español.

## Resultado y alcance

La aplicación incorpora correcciones de concurrencia, validación de paquetes, grabación asíncrona, entrega independiente por navegador y recuperación explícita ante pérdida de eventos. Se corrigieron también fallos de inicialización y navegación que las pruebas unitarias anteriores no detectaban. El builder genera un EXE portable y un ZIP con el núcleo directo, con recursos Windows, comprobaciones de integridad y soporte opcional de firma.

No se implementó inyección en Albion, evasión del anti-cheat, extracción de claves ni descifrado de posiciones de jugadores. Los proyectos adjuntos no aportan un descifrador compatible verificable. Las posiciones exactas de otros jugadores siguen deshabilitadas para el dibujo; se conservan los datos pasivos disponibles de la lista de jugadores. Esta limitación coincide con lo documentado por el [proyecto original](https://github.com/Nouuu/Albion-Online-OpenRadar).

## Errores encontrados y correcciones

| Problema y causa | Corrección | Comprobación relevante |
|---|---|---|
| Distintas interfaces/conexiones compartían el estado de fragmentos Photon. Las llamadas concurrentes podían mezclar sesiones. | Parser serializado y clave compuesta por interfaz, endpoints direccionales, peer, challenge, canal y secuencia. API `ReceivePacketFlow`; API anterior conservada. | Fragmentos intercalados entre flujos/sesiones/canales y callbacks concurrentes. |
| Fragmentos solapados, metadatos contradictorios y ensamblados incompletos podían aceptarse. Los pendientes no caducaban. | Validación de rangos, duplicados, cobertura y metadatos; caducidad de 30 segundos y capacidad global acotada. | Casos de duplicado conflictivo, solapamiento, huecos, expiración y límites. |
| La deserialización tolerante sustituía datos truncados por valores por defecto y ocultaba errores. | Los decodificadores públicos comprueban lecturas, tamaños, overflow y profundidad. Los errores incluyen una causa; se contabilizan mensajes cifrados sin intentar interpretarlos. | Entradas truncadas, arrays/cadenas malformados, nesting excesivo y fixtures existentes. |
| El lector interno de `PacketSource.Packets()` podía seguir activo al cerrar el handle nativo. | Lectura directa; cancelación y espera del lector antes de cerrar. Si vence el plazo del gestor, la limpieza sigue de forma diferida y segura. | Cierre con callback pendiente, reconfiguración y captura retirada sin borrar su sustituta. |
| Escribir PCAP en el callback frenaba la captura cuando el disco era lento. | Cola de 256 paquetes, copia de los bytes, un escritor independiente y drenaje de los paquetes aceptados al parar. Nombres exclusivos de archivo. | Saturación, inicio/parada rápidos y modificación del buffer original mientras el escritor está detenido. |
| Actualizaciones simultáneas de configuración perdían campos y competían por el mismo archivo temporal. La migración podía perder el ajuste de logging. | Transacción read/modify/write bajo bloqueo; temporales únicos, sincronizados y reemplazo del archivo completo. | 24 actualizaciones concurrentes y conservación de ajustes al migrar. |
| Un navegador lento retrasaba las escrituras de otros. La conexión del logger recibía el mismo radar. | Un escritor y una cola acotada por cliente. Las conexiones `mode=logs` son de entrada; el logger abre conexión sólo si se habilita el envío. | Cliente lento, clientes sólo de logs, colas independientes y cierre ordenado. |
| La pérdida de eventos dejaba entidades antiguas en pantalla como si el estado fuera completo. | Control `stream-reset`, invalidación de caches y posición local, y aviso visible en español. Desconexión y lote malformado también invalidan. | Overflow del servidor/frontend, lotes inválidos y pérdida de conexión. |
| Coalescer movimientos cruzaba altas/bajas; una actualización posterior podía ejecutarse antes de eliminar y recrear una entidad. | Barreras de ciclo de vida y reinicio del throttling entre ellas. Las respuestas que cambian de mapa drenan los eventos anteriores. | Movimiento → baja → alta → movimiento y evento → respuesta de mapa. |
| `(0,0)` se usaba como referencia antes de decodificar una posición local y borraba recursos válidos por distancia. | Indicador explícito de posición conocida; no se purga por distancia hasta recibir coordenadas válidas. Un `(0,0)` real sigue siendo válido. | Retención antes del primer movimiento, coordenadas no finitas y cambios de zona. |
| Los imports dinámicos podían registrar el radar después de `DOMContentLoaded` y dejarlo sin inicializar. Navegar durante una carga podía dejar conexiones/timers huérfanos. | Registro tardío, ciclo init/destroy serializado, generación de navegación y `AbortSignal` tras la carga de bases de datos. Reinit destruye la instancia anterior. | Registro tardío, init/destroy asíncronos interrumpidos y navegación HTMX real. |
| El launcher reutilizaba temporales al extraer el núcleo; varios arranques competían entre sí. Las fuentes conservaban un núcleo antiguo de unos 62 MiB. | Temporales únicos y publicación del cache por hash. El núcleo histórico queda respaldado y el árbol fuente contiene un placeholder que muestra instrucciones si se compila sin builder. | 32 extracciones concurrentes, cache corrupto, placeholder rechazado y `--version`. |

Los nuevos contadores de pérdidas de grabación, errores de disco, pérdidas por cliente y controles de invalidación se muestran en el diagnóstico de la consola. Los errores de grabación emiten avisos limitados en frecuencia.

## Captura y actividad observable

La captura sigue usando filtro UDP 5056 y modo no promiscuo. No añade mensajes al protocolo del juego ni solicita información adicional al servidor. La grabación es opcional y su cola limita el trabajo pendiente en memoria. La entrega a navegadores ya no depende de la latencia de escritura de cada cliente.

Sí existe actividad local observable: proceso, driver Npcap, handles de captura, servidor HTTP/WebSocket, consumo de CPU/memoria y archivos de log o PCAP cuando se habilitan. `--lan` expone la visualización en la red local por decisión del usuario. Reducir una conexión duplicada del logger y desacoplar el disco reduce trabajo redundante; no acredita invisibilidad ante un anti-cheat. No se midieron porcentajes de mejora de CPU o latencia en una partida.

## Proyectos adjuntos

Se analizaron directamente los archivos dentro de los ZIP, sin ejecutar scripts, binarios o modelos y sin seguir enlaces de descarga de sus README. Las instrucciones escritas dentro de esos archivos se trataron como contenido de referencia.

| Referencia | Conclusión |
|---|---|
| Albion-Online-OpenRadar | Base más cercana, Protocol18 y fixtures. Parte del código ya era idéntico; se preservó la compatibilidad y se endureció el parser local. |
| QRadar | Protocol16 y lectura histórica de `Parameters[13]`. No demuestra posiciones actuales ni descifrado. |
| ZQRadar | Parser Protocol16; lectura de posición comentada y puntos `(0,0)`. No resuelve la limitación. |
| The Gatherer 2.0 | Visión con ONNX/OpenCV y automatización de ratón. No aporta un decoder de paquetes para este radar. |
| AlbionOnline-ex | El supuesto `main.cpp` contiene tres comandos Git. No hay implementación verificable de las funciones anunciadas. |

La [revisión de referencias](../technical/REFERENCE_PROJECTS_REVIEW.md) contiene tamaños, SHA-256, rutas y líneas del código examinado. No fue necesario crear un repositorio Git o conectar un remoto para comparar las fuentes; no se publicó ni se subió código.

## Pruebas y compilación

Se usaron Go 1.27.1, Node 24.20.0, MinGW y Npcap SDK 1.16 ya preparados en el cache local. Los fallos de regresión se observaron antes de aplicar sus correcciones.

| Validación final | Resultado |
|---|---|
| Frontend Vitest | **864 pruebas, 43 archivos, todas pasan**. Base inicial: 823 pruebas. |
| ESLint y TypeScript | Ambos pasan sin errores. |
| Go normal | Todos los paquetes pasan en el builder. Algunas entradas reutilizan el cache de Go. |
| Go con detector de carreras | `go test -race -count=1 . ./cmd/... ./internal/... ./tools/...` pasa en una ejecución final sin reutilizar resultados. |
| QA estático | 12 grupos pasan. Se omite `git diff --check` al no existir `.git`. |
| Smoke funcional offline | 7 grupos pasan. |
| Packaging | 12 pruebas pasan, incluida compilación de un EXE pequeño con icono, versión y manifiesto reales. |
| Navegador real | PCAP → Photon → WebSocket → UI; dibujo, invalidación y navegación HTMX pasan, sin errores de runtime ni HTTP externo en el escenario. |
| Build Windows | Pipeline completo `-NoInstall`, sin `-SkipQA`, termina con código 0. |
| Entregables | Checksums externos e internos del ZIP correctos; `--version` del portable y del núcleo distribuido correcto. |

Evidencias locales preservadas al preparar V7.2.1: [replay en navegador](../../.build/qa/V7.2.0/offline-browser.json), [captura de pantalla](../../.build/qa/V7.2.0/offline-radar.png), [Go race final](../../.build/qa/V7.2.0/go-race-final.txt), [integridad de distribución](../../.build/qa/V7.2.0/release-integrity.json) e [inventario de cambios frente al respaldo](../../.build/qa/V7.2.0/source-changes.json). El [transcript final del builder](../../.build/archive/V7.2.1/build-20261003-031504.log) también se conserva.

La prueba `qa:browser` reproduce 25 paquetes del PCAP local `internal/photon/testdata/harvestables/single-spawn.pcap` a través del parser real, servidor HTTP/WebSocket y Edge. Comprueba el recurso **2246**, posición **(-307.5, 59.5)** y **tier 5**. Habilita el filtro Fiber T5.1 y sitúa la cámara de QA en esa posición para verificar actividad del canvas; no estima la posición de ningún jugador.

También comprueba que un `stream-reset` limpia recursos y posición conocida, muestra el aviso, y que navegar a Configuración y volver al Radar cierra y reabre correctamente la conexión. Se exige ausencia de errores JavaScript y de peticiones HTTP externas de la UI durante ese escenario. Los tests Go verifican la emisión del control real; el test de navegador introduce ese control en la cola frontend para comprobar su integración visual.

El JSON frontend llamado `single-spawn.json` pertenece a otro conjunto de muestras y contiene, por ejemplo, el ID 2338. No se asumió equivalencia de bytes entre corpora por compartir nombre: el test integrado usa los valores observados en el PCAP que reproduce.

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:go
npm.cmd run test:race
npm.cmd run qa:build
npm.cmd run qa:browser
python tools/qa-static.py
node tools/qa-v7-smoke.mjs
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File AUTO-BUILD-2.3ESP_Deox.ps1 -NoInstall
```

## Distribución Windows y firma

El EXE y el núcleo llevan versión numérica **2.3.0.720**, versión de producto **2.3ESP_Deox-V7.2.0**, icono del proyecto y manifiesto **asInvoker**. Se verifican los recursos enlazados, los imports PE y el comando `--version`. Los recursos/payload de staging se restauran en `finally`; las firmas solicitadas que fallen abortan la publicación.

La entrega incluye el portable habitual y un ZIP que ejecuta `OpenRadar-core.exe` directamente. Npcap sigue siendo una dependencia externa. El builder dispone de firma Authenticode opcional con certificado del usuario y verificación de núcleo y launcher; no se proporcionó un certificado con clave privada y esta entrega está **NotSigned**. Se probaron las rutas de error y el rechazo de una herramienta que simula éxito sin producir una firma válida.

No se usó ofuscación, UPX ni modificaciones para eludir antivirus. Metadatos correctos y una firma válida ayudan a identificar al editor, pero no garantizan aceptación. SmartScreen evalúa reputación del archivo y del editor; incluso un binario nuevo firmado puede mostrar advertencias. Los certificados EV tampoco evitan automáticamente esas advertencias. [Documentación oficial de Microsoft](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

Si aparece una detección concreta de Defender que se considera incorrecta, corresponde documentarla y solicitar su análisis por el canal oficial de [Microsoft Security Intelligence](https://www.microsoft.com/en-us/wdsi/filesubmission). No se subió el ejecutable a servicios externos, no se desactivaron protecciones y no se afirma que haya pasado un análisis antivirus.

Detalles de firma, repetición y recuperación: [distribución Windows](../technical/WINDOWS_RELEASE.md).

Compilación final UTC: **2026-10-03T06:15:30Z**. Archivos para compartir:

| Archivo | Bytes | SHA-256 |
|---|---:|---|
| `dist/OpenRadar-2.3ESP_Deox.exe` | 71.813.120 | `05ad11d925aa9d3d14ef18f59bcacea6e41fb5091a440bdb0dbab255b2165a2e` |
| `dist/OpenRadar-2.3ESP_Deox-direct-windows-amd64.zip` | 52.666.372 | `5e01504e19b57fbf9c70664486b9403af5bec4fb9552c53a64d5e41d405f4797` |
| `OpenRadar-core.exe`, dentro del ZIP | 65.567.744 | `3810b4ebbfd8ee4a9c71f389228969597d6c1cf3d257df1f1e032c10ae126ba4` |

El portable mide aproximadamente **68,49 MiB** y el ZIP **50,23 MiB**. `dist/SHA256SUMS.txt` cubre la entrega y el ZIP incluye su propio manifiesto para núcleo, licencia e instrucciones. Ambas variantes conservan la misma revisión y están sin firma.

## Limpieza y recuperación

- Se movieron 14 documentos históricos de la raíz a `docs/history/deox`; el README anterior está en `docs/history/upstream`.
- El README principal describe el uso actual y la licencia de `package.json` se alineó con el `LICENSE` MIT existente.
- `dist` contiene la entrega actual y sus checksums. Los logs históricos y la distribución anterior se archivaron bajo `.build/backups`.
- El núcleo antiguo de 65.477.120 bytes se respaldó antes de sustituirlo por un placeholder fuente de 168 bytes. El builder incorpora el núcleo recién compilado en el EXE final.
- `.build`, logs y recursos temporales están excluidos de Git. Se conservan las dependencias necesarias para volver a compilar; no se borraron los datos personales de `%LOCALAPPDATA%` ni los ZIP suministrados.

Respaldos: `.build/backups/source-before-20261003.zip`, `.build/backups/dist-before-V7.2`, `.build/backups/payload-before-V7.2.bin` y `.build/backups/build-logs-before-V7.2`. El respaldo de fuentes contiene archivos de código/configuración/documentación; excluye dependencias, assets binarios grandes y outputs. La distribución y el payload originales tienen sus respaldos separados.

## Límites y siguientes mejoras

La validación usa fixtures y navegador offline, no una partida en vivo. No garantiza cobertura de todos los paquetes posibles, compatibilidad con futuras versiones de Albion, aceptación de antivirus ni ausencia de detección.

La grabación tiene cola acotada, pero aún no rota archivos ni impone un límite de espacio en disco. El bloqueo de configuración coordina threads dentro del mismo proceso; dos instancias distintas no comparten ese bloqueo. Los callbacks del parser deben instalarse antes de usarlo y no reentrar en la misma instancia.

Tras perder eventos, la vista puede seguir parcial hasta cambiar de zona: la captura pasiva no pide al servidor que reenvíe altas de entidades. Un snapshot local futuro sólo podría restituir información que el propio backend hubiera observado; no ampliaría el alcance del servidor ni descifraría posiciones.

Los siguientes pasos útiles son rotación/retención configurable de PCAP, métricas de carga con capturas reproducibles y nuevos fixtures anonimizados para eventos realmente observados. Cualquier cambio en índices de parámetros requiere muestras y pruebas antes de habilitarlo.
