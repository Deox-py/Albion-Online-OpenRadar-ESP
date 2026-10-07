# Revisión de los proyectos de referencia

Revisión histórica de cinco ZIP proporcionados para análisis, realizada el 3 de octubre de 2026. Los ZIP y los inventarios privados no se incluyen en este repositorio. Se leyó el inventario y el código directamente desde los archivos ZIP; no se ejecutaron sus scripts, binarios, modelos ONNX ni instaladores, y no se visitaron sus enlaces externos. Los números de línea siguientes corresponden al archivo dentro del ZIP, antes de cualquier cambio local.

Entre los archivos fuente revisados no se encontró un descifrador de posiciones de jugadores compatible con la captura pasiva actual de OpenRadar. Hay referencias útiles para validar el protocolo, organizar entidades y presentar configuraciones, pero no justifican habilitar coordenadas cifradas ni importar un proyecto completo.

## Archivos identificados

| ZIP | Bytes | Entradas | SHA-256 |
|---|---:|---:|---|
| Albion-Online-OpenRadar-main.zip | 61057399 | 4617 | `cae76d29932f1dbd475be33baeb1da3deea77b910a76d1c6072bfa7b7c4b3e2e` |
| The-Gatherer-The-Gatherer-2.0.zip | 48670257 | 14 | `8bef4db339b0f175b978d4f394b710e490b7e30eff788b14f405c5c3f63930f8` |
| Albion-Online-Radar-QRadar-main.zip | 28256893 | 8731 | `0bbd5bd9df896f9ce4dc48cbd5fb349facb55325d1986a88fbcdba70dda245a0` |
| Albion-Online-ZQRadar-main.zip | 12958962 | 247 | `113ac05449eec5dc1403b76685a15c788cf52338bfdd7c71eb65f85701d915d4` |
| AlbionOnline-ex-main.zip | 14893 | 4 | `cf82b6272dfc5a15a18216c1a355d6880c3d5a1f355ed4ac4596f2811a284537` |

El hash identifica la copia analizada y no acredita que su autor sea quien afirma el README.

## Qué aporta cada uno

| Proyecto | Evidencia del código | Valor para esta release |
|---|---|---|
| OpenRadar upstream | Parser Go de Protocol18, fixtures, manejo de fragmentos y documentación de posiciones cifradas. `internal/photon/packet.go:146` notifica el mensaje cifrado y lo omite; no lo descifra. | Es la referencia más cercana al código actual. Preservar fixtures y formatos; no reemplazar el parser endurecido por la copia anterior. |
| QRadar | `scripts/classes/PhotonCommand.js:1` importa `Protocol16Deserializer`. `PlayersHandler.js:111` trata `Parameters[13]` como una matriz de coordenadas. | Sirve para comparar funciones de UI y nombres históricos. Su formato de parámetros no demuestra compatibilidad con Protocol18 actual. |
| ZQRadar | Conserva el parser Protocol16. `PlayersHandler.js:128` comenta la lectura de posición y en `:152` registra el jugador con `(0,0)`. | El código confirma que no ofrece una solución de posiciones de jugadores. Tiene patrones de selección de adaptador y actualización de entidades que conviene comparar con lo ya existente. |
| The Gatherer 2.0 | `window_capture.py:28` captura pantalla con GDI; `onnx_detextion.py:8` carga ONNX con OpenCV; `bot_thread.py:62` mueve y pulsa el ratón. | Es visión por pantalla y automatización, no un parser de paquetes. Sus modelos no resuelven datos cifrados y su automatización queda fuera del alcance pasivo autorizado. |
| AlbionOnline-ex | `main.cpp:1` contiene únicamente `git add`, `git commit` y `git push`. El ZIP contiene README, LICENSE y ese archivo. | Las funciones anunciadas por el README carecen de implementación verificable en la copia entregada. No hay módulo que importar o probar como radar. |

## Hallazgos técnicos comprobables

QRadar y ZQRadar comparten exactamente el mismo `scripts/classes/Protocol16Deserializer.js`, SHA-256 `efa9c0f415efe2ba3eb70cb7ad456888bca9ab26bc7719ab51d2fe14c51868b4`. En `:191–199` leen dos floats little-endian en offsets 9 y 13 y los añaden como parámetros 4 y 5. No hay clave ni operación de descifrado en esa ruta. Leer floats de bytes cifrados puede producir valores numéricos sin que representen una posición válida; una comprobación de finitud tampoco acredita que estén descifrados.

Los `PhotonCommand.js` revisados gestionan comandos 4, 6 y 7 (`:46–59`), pero no incluyen ensamblado del comando fragmentado 8. OpenRadar ya contempla fragmentos y esta release añade aislamiento por flujo, sesión y canal, límites de memoria y rechazo de fragmentos inconsistentes. Copiar el parser JavaScript supondría perder esos controles.

En QRadar, `app.js:109–153` registra los listeners de captura y parser dentro de cada conexión WebSocket, y `:128–130` descarta la excepción sin diagnóstico. Ese patrón puede multiplicar el trabajo por conexión y ocultar errores. ZQRadar mueve el listener de captura fuera de la conexión (`app.js:169–180`), una mejora conceptual, pero su función `async` ejecuta el parser de forma síncrona y sus broadcasts siguen sin una cola acotada por cliente. La implementación actual utiliza un productor de captura independiente y colas por cliente; no se copió este código.

La selección y recuperación del adaptador en ZQRadar (`server-scripts/adapter-selector.js:5–58`, `app.js:124–150`) es una referencia útil para mostrar la interfaz elegida y pedir una nueva selección cuando desaparece. Guarda la IP en `ip.txt`; una IP puede cambiar, por lo que conviene mantener el identificador de interfaz y verificar disponibilidad como hace el gestor actual, en vez de importar esa persistencia directamente.

`FishingHandler.js:52–62` actualiza o inserta peces por ID y `:82–85` los elimina. `WispCageHandler.js:22–31` evita duplicados y `:34–48` elimina jaulas abiertas. Son patrones aplicables a la UI, pero los índices de parámetros requieren fixtures y validación de longitud/tipo para el protocolo actual. El `FishingHandler.js` del ZIP upstream de OpenRadar ya es idéntico al archivo local; importar el de ZQRadar no aporta una mejora demostrada.

La comparación de bytes con el ZIP de OpenRadar confirmó que los archivos locales `internal/photon/events.go`, `internal/photon/upstream_fixtures_test.go`, `internal/photon/live_pcap_test.go` y `web/scripts/handlers/FishingHandler.js` ya contienen la misma base. Las copias actuales de `deserializer.go`, `PlayersHandler.js`, `WispCageHandler.js` y `network_config.go` difieren; no se sobrescribieron con el upstream.

## Comprobación posterior

Se verificó también el repositorio público de AlbionOnline-ex y el nuevo `Git_Project.zip` suministrado después de esta revisión. La [comprobación adicional](ALBIONONLINE_EX_ADDITIONAL_REVIEW.md) distingue las funciones anunciadas del código disponible y documenta la lectura estática del paquete binario.

## Mejoras adoptadas y pendientes

Esta revisión respalda conservar Protocol18 y sus fixtures, probar paquetes truncados y fragmentos entre flujos distintos, exponer errores, y mantener la captura independiente del número de navegadores. También respalda la selección visible de adaptadores y la actualización de entidades por ID. Esas ideas se evalúan sobre el código local y con pruebas propias, sin ejecutar las aplicaciones de referencia.

No se incorporó un descifrador, una automatización de ratón, una inyección en el juego ni un intermediario de tráfico. No se habilitaron puntos de jugadores a partir de `(0,0)`, parámetros históricos o floats reinterpretados sin datos válidos. Los fixtures y pruebas offline pueden demostrar decodificación y entrega a la UI para sus entradas; no demuestran posiciones de jugadores cifradas ni compatibilidad con una partida o versión futura del servidor.

Para cualquier mejora adicional del formato de eventos harían falta muestras de captura válidas, identificadas y compatibles con Protocol18, acompañadas de pruebas que separen posiciones observadas de datos cifrados. Antes de copiar código o assets de otra referencia también debe comprobarse su licencia concreta; las declaraciones de README o package.json no sustituyen esa revisión.
