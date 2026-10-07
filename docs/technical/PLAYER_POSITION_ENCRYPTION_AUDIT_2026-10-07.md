# Cifrado y posiciones de jugadores: revisión del 7 de octubre de 2026

El aviso `Encrypted traffic seen` confirma que OpenRadar reconoció una marca de cifrado; no identifica jugadores, coordenadas ni el algoritmo negociado. Las dos capturas proporcionadas contienen mensajes Photon legibles junto con mensajes marcados como cifrados. No se ha recuperado ni validado una posición de otro jugador.

Se revisó la rama `codex/radar-v7.3.2`, partiendo de `f26b1ed9f6c1ce8bfadbd916d61a1ac016e8d1ae`, y fuentes públicas fijadas a commits. Se analizaron las capturas localmente, sin ejecutables de terceros, sin modificar el juego y sin enviar los PCAPNG a GitHub. Este informe publica únicamente estadísticas y formatos de parámetros; los archivos, direcciones, identidades y valores brutos permanecen fuera del repositorio.

## Qué mecanismos están documentados

La [API oficial de Photon Server 5](https://doc-api.photonengine.com/en/server/current/namespace_photon_1_1_socket_server_1_1_security.html) enumera estos seis modos. Son capacidades del SDK: su existencia no demuestra que Albion haya elegido uno concreto.

| Modo Photon | Protección documentada | Evidencia en estas capturas |
| --- | --- | --- |
| `PayloadEncryption` | AES-256-CBC sobre el contenido del mensaje | Se observa la marca de mensaje cifrado; no se identifica la variante AES |
| `PayloadEncryptionWithIV` | Variante anterior con IV añadido | Variante no determinada |
| `PayloadEncryptionWithIVHMAC` | Variante con IV y HMAC | Variante no determinada |
| `DatagramEncryption` | AES-256-CBC sobre el datagrama | No aparece la marca de paquete `0x01` reconocida por este parser |
| `DatagramEncryptionWithRandomInitialNumbers` | Variante de datagrama con números iniciales aleatorios | No determinada |
| `DatagramEncryptionGCM` | AES-256-GCM y números iniciales aleatorios | No determinada |

La misma API advierte que el identificador de GCM pasó de 12 a 13 por un cambio incompatible. La [API PUN 2](https://doc-api.photonengine.com/en/pun/current/namespace_photon_1_1_realtime.html) muestra otro conjunto de nombres. No se deben trasladar identificadores de una versión del SDK al juego sin comprobar su implementación.

También existen transportes protegidos: [Photon documenta WSS sobre TLS](https://doc.photonengine.com/realtime/v5/reference/encryption), y [Realtime Core 6 contempla DTLS para UDP cuando el servidor lo admite](https://doc.photonengine.com/realtime-core/v6/manual/connection-and-regions). No se ha identificado su uso para posiciones en estas muestras UDP 5056. Tampoco hay evidencia aquí para atribuir RSA, ChaCha20 u otros algoritmos al movimiento de Albion.

Diffie–Hellman es un intercambio de claves; SHA-256 puede participar en derivación y HMAC en autenticación. No son tres cifrados adicionales de coordenadas. [Photon Server](https://doc.photonengine.com/server/v5/applications/loadbalancing/encryption) documenta tanto intercambio por Diffie–Hellman como entrega de claves mediante WSS en SDK recientes. Capturar un intercambio público no proporciona por sí solo el secreto de sesión.

## La capa de posiciones de Albion

La documentación heredada del [upstream OpenRadar](https://github.com/Nouuu/Albion-Online-OpenRadar/blob/main/docs/technical/PLAYER_POSITIONS_MITM.md) describe una capa XOR de coordenadas con un `XorCode` de ocho bytes y un evento `KeySync` protegido por Photon. Es una explicación histórica compatible con datos de posición que no se pueden interpretar directamente, pero no verifica la clave, los offsets ni el modo AES de las sesiones adjuntas.

En esta rama `Move = 3`, `NewCharacter = 29` y `KeySync = 603` figuran en [eventcodes.go](../../internal/photon/eventcodes/eventcodes.go). No se decodificó ningún evento con código real 603 en las muestras. Eso no demuestra que no se transmitiera: el contenido de los mensajes cifrados se omite antes de conocer su código. Los números del enum pueden cambiar con parches.

La frase heredada «todo UDP 5056 está cifrado» es demasiado amplia. Tampoco se han comprobado para estas sesiones las afirmaciones antiguas sobre IV nulo, parámetros exactos de DH, clave XOR o necesidad de un proxy concreto. El documento anterior se conserva como historial con una advertencia de esta revisión.

## Qué cuentan tus mensajes de consola

En [packet.go](../../internal/photon/packet.go), `ReceivePacketFlow` notifica `OnEncrypted` si el tercer byte del encabezado es `1`; `handleSendReliable` lo hace si el tipo de mensaje tiene el bit `0x80` activo. Ambos caminos alimentan el mismo contador de [main.go](../../cmd/radar/main.go).

El log sólo se imprime cuando `n % 100 == 1`. Por eso aparecen 1, 101, 201, 301, 401 y 501: el incremento es por detecciones entre avisos, no por lotes de cien jugadores. Puede contar mensajes o paquetes; un datagrama puede incluir varios comandos. Si no hubo más líneas después de 501, el fragmento no permite distinguir entre 501 y 600 detecciones antes del siguiente aviso, ni calcular su proporción sin el total de tráfico.

`0x82` y `0x84` son tipos de mensaje con la marca de cifrado y tipos base 2 y 4. `0x83`/131 tampoco es un identificador de algoritmo AES. El parser reconoce una marca, sin autenticar ni descifrar su contenido.

## Resultados de las dos capturas

Las fechas siguientes proceden del PCAPNG, convertidas a America/Sao_Paulo (UTC−03:00). A es la captura adjunta del escritorio; B es la de Documentos. Se cuentan registros capturados, sin deduplicar retransmisiones o interfaces. «Eventos» significa callbacks del parser, no jugadores distintos; un datagrama puede producir varios callbacks.

| Medida | A: 7 oct., 03:16:24–03:17:35 | B: 4 oct., 05:37:52–05:45:06 |
| --- | ---: | ---: |
| Registros totales | 205273 | 486350 |
| Registros con longitud capturada menor que la original | 0 | 0 |
| Datagramas UDP con puerto origen o destino 5056 | 590 | 4830 |
| Encabezado interpretado con marca `0x00` | 584 | 4827 |
| Tercer byte `0x2d`, formato no reconocido | 6 | 3 |
| Marca de paquete cifrado `0x01` | 0 | 0 |
| Marca CRC `0xcc` | 0 | 0 |
| Detecciones de mensaje cifrado `0x82` | 2 | 2 |
| Detecciones de mensaje cifrado `0x84` | 7 | 18 |
| Total de callbacks `OnEncrypted` | 9 | 20 |
| Eventos legibles decodificados | 1158 | 7746 |
| Requests / responses legibles | 80 / 11 | 319 / 17 |
| Eventos reales `NewCharacter` / `Move` | 76 / 618 | 92 / 6254 |
| Errores de parser | 8 | 4 |

La ausencia de registros recortados no prueba ausencia de pérdida de red. Estas capturas tampoco cubren todo el intervalo del log 02:11–03:09: no se puede vincular el aviso original a un paquete concreto.

### El error de longitud de 400 bytes

Se reprodujo `handleCommand: invalid command length` para payloads de 400 bytes: cuatro en A y dos en B. Todos tienen tercer byte `0x2d` y el byte que el parser interpreta como número de comandos vale 213. Bajo su supuesto de encabezado Photon de doce bytes, la primera longitud de comando es cero o supera el payload. También aparecen dos errores de encabezado truncado en A y uno en B, sobre payloads de 16 bytes con el mismo patrón.

Esto localiza el fallo en el encuadre anterior a la deserialización de eventos. No demuestra corrupción en tránsito ni identifica otro cifrado: falta clasificar esas tramas. No se deben contar automáticamente como coordenadas cifradas. Los otros errores son `deserialize event failed: truncated parameter value`: dos en A y uno en B. Son una ruta distinta y requieren estudiar su estructura antes de corregir el parser. Ninguno se explica aquí por CRC: no se observó `0xcc`.

### Los floats finitos tampoco validan coordenadas

Se asociaron `Move` a IDs previamente observados en `NewCharacter` dentro del mismo flujo direccional, peer y challenge, retirándolos al observar `Leave`. Se examinó el blob sin intentar descifrarlo.

- A: 600 blobs modo 3/30 bytes. Los floats leídos en offsets 9/13 son finitos en los 600; en 379 al menos uno tiene valor absoluto superior a 10000.
- B: 5971 blobs modo 3/30 bytes. En 5784 ambas lecturas son finitas y en 187 alguna no lo es; en 4002 pares finitos al menos un valor absoluto supera 10000.
- También hay modos/longitudes 1/22 en A; 0/18, 1/22, 5/26 y 7/34 en B. No se ha establecido que todos compartan los offsets del modo 3.

El umbral 10000 es una clasificación descriptiva, no un límite oficial del mapa. Ni valores pequeños, ni finitud, ni continuidad aparente prueban descifrado. [events.go](../../internal/photon/events.go) actualmente evita NaN/Inf para que JSON pueda serializarse; su comentario no debe interpretarse como una garantía de excluir todos los movimientos cifrados. [PlayersDrawing.js](../../web/scripts/drawings/PlayersDrawing.js) mantiene deshabilitado el dibujo de jugadores y [PlayersHandler.js](../../web/scripts/handlers/PlayersHandler.js) los registra sin posición validada.

En los 76 y 92 eventos `NewCharacter`, el parámetro 12 se decodifica como entero y el 13 como string. Por tanto, ejemplos antiguos que usan directamente uno de esos parámetros como array de coordenadas no encajan con estas muestras.

## Comprobación de proyectos en GitHub

| Fuente inspeccionada | Resultado |
| --- | --- |
| [DocTi, MoveEvent.cs, commit 3a69b70](https://github.com/DocTi/albion-network/blob/3a69b70b0cdabb1db37c45390489bfe1a0437a74/Albion.Network.Example/MoveEvent.cs) y [NewCharacterEvent.cs](https://github.com/DocTi/albion-network/blob/3a69b70b0cdabb1db37c45390489bfe1a0437a74/Albion.Network.Example/NewCharacterEvent.cs) | Commit del 12 feb. 2023. Lee floats en offsets 9/13 y un array de spawn en parámetro 12; esas rutas no incluyen descifrado ni acreditan compatibilidad actual. |
| [Albion Data Client, parser.go, commit 12ff34e](https://github.com/ao-data/albiondata-client/blob/12ff34e2964869ed616d284f4be82dd36c62a5f3/client/photon/parser.go) | Commit del 16 sep. 2026. Reconoce paquete cifrado y mensaje 131, CRC y encuadre de paquetes concatenados. Es referencia de transporte; no descifra posiciones en la ruta inspeccionada. |
| [StatisticsAnalysisTool, PhotonParser.cs, commit 3c90f93](https://github.com/Triky313/AlbionOnline-StatisticsAnalysis/blob/3c90f930f742118ee6ffc8977f2f7f376af97016/src/StatisticsAnalysisTool.PhotonPackageParser/PhotonParser.cs) | Commit del 22 sep. 2026. El parser descarta paquetes cifrados y verifica CRC. Su [NewCharacterEvent.cs](https://github.com/Triky313/AlbionOnline-StatisticsAnalysis/blob/3c90f930f742118ee6ffc8977f2f7f376af97016/src/StatisticsAnalysisTool/Network/Events/NewCharacterEvent.cs) no aporta una posición descifrada. |
| Referencia histórica `pxlbit228/albion-radar-deatheye-2pc` | La consulta pública devolvió 404. No se verificó su código actual ni un descifrador utilizable; las menciones heredadas de Cryptonite no sustituyen esa comprobación. |

## Actualización y verificación

Esta actualización aporta el informe y avisos en las notas históricas. Mantiene la versión V7.3.2 y no cambia runtime, automatización, captura ni dibujo. No crea una nueva release ni un EXE con supuesto descifrado.

Se ejecutaron el replay agregado de ambos PCAPNG, `go test -count=1 ./internal/photon/...`, y `go test -race -count=1 ./internal/photon/...` después de configurar CGO con `tools/go-env.ps1`: aprobados. La primera invocación de race sin CGO no pudo ejecutarse; la ejecución configurada pasó. Las pruebas existentes de `PlayersHandler`, `PlayerListRenderer` y `EventRouter` aprobaron: 202 tests en tres archivos. No se recompiló porque sólo se editó documentación.

Los resultados detallados y el script de investigación quedan localmente en `.build/qa/encryption-20261007/`, excluidos de Git. Los dos EXE seleccionados, V7.3.2 y V7.3.1-Old, conservan sus versiones y hashes verificados. Para determinar el modo exacto de una sesión hace falta evidencia de su negociación o implementación, y para habilitar posiciones hace falta un formato validado y una comparación independiente con posiciones conocidas. Este análisis no dispone de esas dos pruebas.
