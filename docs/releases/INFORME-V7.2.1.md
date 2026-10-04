# Informe de mejoras — OpenRadar V7.2.1

3 de octubre de 2026. Complementa el [informe V7.2.0](INFORME-V7.2.0.md). Implementación, revisión, pruebas y compilación final completadas. Build UTC: **2026-10-03T14:29:37Z**.

## Zoom del radar

La rueda sobre el canvas, los botones +/− y el deslizador comparten una escala de 10 a 300 %. Restablecer vuelve a 100 %. Se conserva en los ajustes y se sincroniza entre pestañas. Los controles aparecen también en pantallas pequeñas; antes el dibujo imponía 90 % e ignoraba la escala seleccionada.

Se normalizan los deltas de rueda en píxeles, líneas o páginas, se acumulan movimientos pequeños de trackpad y se limita cada salto. Ctrl+rueda queda disponible para el zoom del navegador. Los listeners se eliminan al salir de la página para evitar aumentos duplicados al volver por HTMX.

Este zoom cambia la escala local del dibujo. No modifica la cámara de Albion ni amplía el alcance de la información enviada por el servidor.

## Mapa al iniciar

Se distinguieron dos causas:

1. **Captura antes de que abra la página.** La inicialización carga bases de datos antes de conectar el WebSocket. El servidor descartaba los mensajes sin espectadores y perdía un Join ya capturado. Ahora conserva sólo el contexto de zona observado y lo entrega al cliente nuevo antes del tráfico normal. No almacena ni reproduce posiciones o entidades del Join.
2. **Inicio del proceso después de entrar a la zona.** Ese Join nunca se capturó. La captura pasiva no puede recuperarlo retrospectivamente. El selector de zonas conocidas permite indicar explícitamente el mapa actual, con estado manual hasta que llegue información observada. No inventa identificadores de instancias dinámicas.

El contexto recuperado se identifica como información capturada y parcial. Las zonas desconocidas muestran un estado neutral. Los datos de sesión antiguos se usan como sugerencia, evitando presentar un mapa anterior como una detección actual.

Se corrigió también una suspensión del procesamiento en pestañas ocultas: si el navegador pausaba un frame pendiente al ocultarse, ahora se programa el vaciado por timer.

Una saturación por cliente entrega primero la invalidación, después el contexto válido y finalmente el tráfico nuevo. Toda pérdida invalida la identidad anterior; un contexto posterior puede recuperarla sin retirar el aviso de entidades incompletas. Las respuestas de ingreso o cambio de zona con error no confirman un mapa nuevo.

La identidad de zona y la imagen de fondo son datos distintos. Algunas instancias dinámicas no tienen una imagen incluida para su identificador, incluso si la instancia ya fue detectada. No se dibuja terreno de otra zona para suplirla. Se corrigió además el tamaño del relleno de fondo para usar las dimensiones reales del canvas.

## Verificación y distribución

| Validación final | Resultado |
|---|---|
| Frontend Vitest | **906 pruebas, 44 archivos, todas pasan**. V7.2.0 tenía 864 pruebas. |
| ESLint / TypeScript | Ambos pasan. |
| Go normal | Todos los paquetes pasan en el builder; algunos resultados usan el cache. |
| Go con detector de carreras | Todos pasan con `-race -count=1`, sin reutilizar resultados de tests. |
| QA estático / smoke | 12 y 7 grupos pasan, respectivamente. |
| Packaging | 12 pruebas pasan; incluyen ambos recursos Windows y restauración de staging ante fallo. |
| Navegador real | Replay offline, recuperación de mapa, selección manual, zoom y navegación pasan. Sin errores JavaScript ni HTTP externo en el escenario. |
| Build completo | `-NoInstall`, sin `-SkipQA`, termina con código 0. |
| Distribución | Checksums externos e internos pasan; núcleo del ZIP idéntico al payload del portable. |

Se observaron los fallos de regresión antes de aplicar sus correcciones. La prueba de navegador usa un Join **sintético de QA**, sin coordenadas, para la zona 1000 antes de conectar el navegador; permite verificar el control emitido por el backend real. Separadamente reproduce los **25 paquetes** del PCAP anonimizado local y comprueba recurso 2246, coordenadas (-307.5, 59.5) y tier 5. Sitúa la cámara de QA en ese punto para comprobar actividad del canvas; esa posición no se estima de un jugador. La selección manual 1001 conserva esa posición y el recurso; la pérdida posterior limpia entidad, identidad y posición conocida. Volver por HTMX recupera contexto y mantiene un único listener de zoom.

Evidencias: [navegador](../../.build/qa/offline-browser.json), [captura de pantalla](../../.build/qa/offline-radar.png), [Go race final](../../.build/qa/go-race-V7.2.1.txt), [integridad y recursos](../../.build/qa/release-integrity-V7.2.1.json) y [transcript del builder](../../build-logs/build-20261003-112856.log).

| Archivo | Bytes | SHA-256 |
|---|---:|---|
| [EXE portable](../../dist/OpenRadar-2.3ESP_Deox.exe) | 71.860.224 | `a7320b73a6c2d53d419a5b9266f3244a6619146982764d73617bcdb1d1863855` |
| [ZIP directo](../../dist/OpenRadar-2.3ESP_Deox-direct-windows-amd64.zip) | 52.679.818 | `0c3236f97f10508cda55c7754dde6b10e729a9eeba3f9556fbbde338e9afbbf0` |
| Núcleo dentro del ZIP | 65.614.848 | `8119ecad5fd86ed8d6afb8d89d5cf367772f7bf654b7ed3b70a6c3308487812a` |

Ambos EXE tienen recursos de versión **2.3.0.721**, marca **2.3ESP_Deox-V7.2.1**, icono y manifiesto `asInvoker`. Ambos `--version` confirman la marca y fecha de build. La comprobación Authenticode devuelve **NotSigned**.

Para usar el zoom, coloca el cursor sobre el radar y gira la rueda; también puedes usar +/−, el deslizador o Restablecer. Para indicar una zona, busca su nombre o ID, selecciona el resultado y pulsa **Usar zona**. **Detección automática** quita esa identidad manual. La selección no aumenta el rango del radar.

Las fuentes y los cinco archivos de distribución V7.2.0 se respaldaron y se verificaron por hash antes de modificar esta entrega. Los respaldos se encuentran en `.build/backups`.

El [inventario de cambios](../../.build/qa/source-changes-V7.2.1.json) registra 32 archivos modificados y 8 módulos/documentos nuevos dentro del alcance de fuentes del respaldo. Se sustituyó una prueba estática del template por pruebas de interacción del controlador de zoom; no se retiró una función del radar. El inventario excluye dependencias e imágenes grandes.

## Correcciones de origen y recuperación

- Cada cambio real de captura detiene y une los lectores anteriores, vacía fragmentos Photon incompletos y el contexto/cola del servidor, y después inicia los nuevos lectores. Así, fragmentos o mensajes de la fuente anterior no pueden presentar un mapa obsoleto.
- Las selecciones sin cambios no reinician lectores. Si falla la preparación de una interfaz ya activa al intentar añadir otra, se cierran los candidatos preparados y se conserva la captura/grabación que funcionaba.
- El servidor conserva una sola identidad de zona, con IDs limitados a 256 bytes; clientes exclusivos de logs no la reciben. El alta de un cliente y el envío se serializan para que el contexto preceda al tráfico nuevo sin repetir el Join anterior.
- Las señales observadas reemplazan la procedencia manual, incluso al confirmar el mismo ID. La información posterior de origen de una Mist actualiza esa instancia sin invalidar coordenadas o entidades. Si no se capturó el modo letal/no letal, se muestra clasificación desconocida en lugar de heredar una zona segura del origen.
- El contexto del mapa no vence arbitrariamente mientras la fuente continúa capturando. Las elecciones pendientes de Mists vencen a los 30 segundos; la herencia entre instancias distintas, a los 30 minutos. La misma instancia conserva sus metadatos observados.

## Limpieza

`dist` conserva sólo los cinco archivos de la entrega final. El núcleo fuente vuelve a ser el placeholder de compilación y no quedan recursos `.syso` temporales. La carpeta `build-logs` conserva el transcript final; los anteriores y los ejecutables/directorios de staging y QA se archivaron en `.build/archive/V7.2.1`. La revisión automática del ejecutor rechazó el borrado de temporales, por lo que se usó archivo reversible. [Registro de archivo](../../.build/qa/cleanup-V7.2.1.json).

Las evidencias V7.2.0 se preservan en `.build/qa/V7.2.0`. No se eliminaron respaldos, fuentes ajenas ni datos del usuario. Para compartir, usa el EXE o ZIP de `dist`; `.build`, logs y dependencias no forman parte de la distribución.

## Referencias adicionales

La inspección de AlbionOnline-ex y Git_Project.zip quedó documentada en el [informe adicional](../technical/ALBIONONLINE_EX_ADDITIONAL_REVIEW.md). El nuevo ZIP aporta un instalador NSIS y archivos de datos, pero no las fuentes de la automatización anunciada. No se ejecutaron sus binarios ni se siguieron sus instrucciones de desactivar antivirus.

## Límites

La selección manual no confirma la instancia, la posición local ni la integridad del listado de entidades. El contexto del servidor es el último observado en la captura; no acredita una conexión al juego que continúe activa. No hay consulta adicional al servidor del juego. La verificación final usa replay offline y pruebas automatizadas, sin comprobar una partida real.

La distribución conserva el esquema transparente de V7.2.0: metadatos, manifiesto asInvoker y soporte opcional de firma. Sin un certificado del editor no se firma esta entrega. No se garantiza un veredicto de antivirus o SmartScreen.
