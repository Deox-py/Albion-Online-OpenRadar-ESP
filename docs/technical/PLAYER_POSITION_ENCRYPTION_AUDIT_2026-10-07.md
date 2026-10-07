# Cifrado y posiciones de jugadores: revisión del 7 de octubre de 2026

El aviso `Encrypted traffic seen` confirma que OpenRadar reconoció una marca de cifrado; no identifica jugadores, coordenadas ni el algoritmo negociado. Las dos capturas proporcionadas contienen mensajes Photon legibles junto con mensajes marcados como cifrados. La investigación posterior recuperó máscaras XOR efectivas a partir de eventos legibles de hechizos y obtuvo 83 comparaciones posteriores exactas de coordenadas protegidas: 74 de aparición y nueve de movimiento. No se ha validado su ubicación visual en el mapa ni recuperado el array original de `KeySync`.

Se revisó la rama `release/radar-v7.3.2`, partiendo de `f26b1ed9f6c1ce8bfadbd916d61a1ac016e8d1ae`, y fuentes públicas fijadas a commits. El análisis inicial de las capturas utilizó el parser del proyecto. La investigación posterior del cliente instalado utilizó Cpp2IL, emulación con datos sintéticos y comprobaciones con pares privados extraídos de las capturas, descritas más abajo. No se modificó el juego ni se enviaron los PCAPNG a GitHub. Este informe publica estadísticas y conclusiones técnicas; los archivos privados, direcciones, identidades, claves y valores brutos permanecen fuera del repositorio.

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

## Investigación del cliente instalado: XOR confirmado

Se inspeccionaron los archivos de la instalación local `albiononline-win32-full-1.32.020.344269`, Unity `6000.3.12f1`, IL2CPP metadata versión 39. Se utilizó la compilación oficial de desarrollo de [Cpp2IL](https://github.com/SamboyCoding/Cpp2IL/tree/b5ad444b82267cb1e4b88b8b373c008105bdea52), conservada sólo en la carpeta local de investigación. Los binarios, metadatos y estructuras recuperadas del cliente no se publican.

| Archivo analizado | SHA-256 |
| --- | --- |
| `GameAssembly.dll` | `591BF7D629EADA8F1D272C3A5468D1019683EDC758F322951DCD852EC6AA13D3` |
| `global-metadata.dat` | `2246890B1944F2FB458273C99BE28B560FE424A97C784798AFC9BA7ACA2029FD` |

La lectura de instrucciones nativas identifica una rutina que aplica XOR byte a byte y reconstruye un float32 little-endian. El lector de movimiento `Albion.PhotonClient/c3d` obtiene el ID del parámetro 0 y el blob del parámetro 1; lee ocho bytes de timestamp después del byte de modo. Para la posición usa los offsets 9 y 13, con desplazamientos de clave 0 y 4. También existe una ruta sin clave, utilizada por otro consumidor del mismo lector. Estos símbolos ofuscados y sus direcciones corresponden sólo a la versión y hashes anteriores.

La ruta de movimiento de jugadores `csf.aft` pasa al lector el array almacenado en `ci5.cg`. Se identificó una rutina `ci5.c7` que guarda en ese campo un array recibido a través del deserializador de eventos. La clase marcada con código 603 tiene un campo `byte[]`, y el enum instalado confirma `KeySync = 603`. Falta observar esa sincronización en una sesión y confirmar su contenido, longitud y envoltura Photon. No se ha obtenido la clave real a partir de estos archivos.

Para verificar el algoritmo sin ejecutar ni conectar el cliente, se emularon las instrucciones de su lector de floats con entradas completamente sintéticas: 12 casos aprobaron una comparación exacta de bits y el avance de cuatro bytes del índice. Incluyen claves de 8 y 7 bytes, desplazamientos 0 y 4, valores positivos, negativos y ceros con signo. Esto demuestra el comportamiento de esa rutina; no demuestra descifrado de jugadores de las capturas. El lector admite un array de clave y accesos cíclicos: no debe inferirse una longitud obligatoria de ocho bytes únicamente de su firma.

Se encontró además un serializador común `n3` que incorpora un ID variable dentro del blob. Se contrastó ese formato con los movimientos asociados a jugadores de las dos capturas: ninguno de los 618 y 6254 IDs reconstruidos coincidió con el ID externo observado. Por tanto, se descartó esa hipótesis para estas muestras y no se cambiaron los offsets del radar por ella.

Una medición adicional confirmó que los parámetros 16 y 17 de los 76 y 92 `NewCharacter` son arrays de ocho bytes. Su tamaño es compatible con dos floats protegidos, pero no revela los bytes de la clave ni valida las coordenadas por sí solo.

La primera prueba en vivo se centró en capturar desde antes de entrar al personaje para observar el intercambio y la sincronización de clave. Su resultado inicial y la recuperación posterior por una vía distinta se presentan a continuación. No se añade un modo replay al radar.

## Captura de inicio y movimiento en vivo

Se realizó una captura nueva mientras el usuario abría el juego, pasaba por selección de personaje, entraba y se movía. `dumpcap` terminó normalmente con 14361 paquetes y cero pérdidas notificadas por la interfaz y el capturador; el lector tampoco encontró registros recortados. Esas cifras no garantizan ausencia de pérdidas fuera del punto de captura. El archivo privado tiene SHA-256 `BC479935BE5B98348B5D44C266C7A24BB70CF3ECFC582099F48F862B38B6E3E5` y permanece fuera de Git.

| Medición de esta sesión | Resultado |
| --- | --- |
| Datagramas UDP 5055 / 5056 | 4423 / 9938 |
| Eventos legibles / requests / responses | 14846 / 1712 / 93 |
| `NewCharacter` / `Move` legibles, todos en 5056 | 231 / 11440 |
| Mensajes marcados como cifrados en 5055 / 5056 | 582 / 61 |
| Mensajes cifrados completos `0x82` / `0x83` / `0x84` con el parser original | 143 / 2 / 498 |
| Solicitudes internas de intercambio sin fragmentar / respuestas de operación 0 | 6 / 6 |
| Responses de operación 0 con array de 96 bytes | 6 |
| Eventos `KeySync` 603 decodificados | 0 |
| Posiciones verificadas visualmente en el mapa | 0 |

Los 231 `NewCharacter` mantienen arrays de ocho bytes en los parámetros 16 y 17. Capturar únicamente 5056 conserva los movimientos observados, pero excluye el tráfico inicial de 5055; por eso la investigación de conexión incluyó ambos puertos. No se debe confundir el puerto del inicio con el de los eventos de movimiento.

La inspección estática adicional del proveedor `Photon3Unity3D/g8i` identifica generación mediante `RNGCryptoServiceProvider`, operaciones `BigInteger.ModPow`, un hash `SHA256Managed` y configuración de `RijndaelManaged`. Esto respalda una ruta de intercambio Diffie-Hellman y derivación de clave en el cliente instalado. No demuestra por sí solo qué proveedor o modo exacto se seleccionó para cada conexión capturada. Los arrays públicos del intercambio no son la clave XOR de posiciones ni bastan para reconstruir el secreto privado de esa ruta.

También se contrastaron los IDs propios recibidos en cinco respuestas `Join` con los eventos posteriores de aparición y movimiento dentro de su flujo/peer/challenge: no se encontraron coincidencias. Por tanto, esta comprobación no proporcionó un par de posición propia legible y posición propia protegida con el que verificar una clave XOR.

El análisis completo se repitió y produjo agregados idénticos. Hay además 27 errores de encuadre del patrón `0x2d` y nueve errores de deserialización; ausencia de un `KeySync` decodificado no prueba que el servidor no lo haya enviado. No se identifica un evento concreto dentro de los mensajes cifrados ni se atribuyen todos los errores al cifrado.

En esta fase inicial se obtuvo una captura de inicio utilizable, pero no el contenido de `KeySync`. Posteriormente se encontró una vía de recuperación de máscaras efectivas mediante `CastSpell`, descrita más abajo. El radar publicado continúa sin habilitar marcadores de jugadores.

## Seguimiento de KeySync y comprobación de permisos

Se resolvió la asociación que faltaba entre el código 603 y el campo de clave. El despachador nativo `ci5.xk` consulta una tabla por código de evento: 603 selecciona la entrada 114 y el bloque en RVA `0x981D54`. Ese bloque deserializa el evento, obtiene el array del campo de su objeto y almacena su referencia directamente en `ci5.cg`, offset `0x2D8`. Coincide con la operación de `ci5.c7`, integrada en el despachador sin una llamada directa a ese método. La ausencia de referencias directas encontrada antes no descartaba esta ruta.

Se verificó la selección de la tabla ejecutando las instrucciones del archivo instalado con cinco códigos sintéticos: 3, 29, 602, 603 y 604. Se emuló además el almacenamiento del bloque 603 con cuatro arrays sintéticos de 5, 7, 8 y 16 bytes: conserva la referencia y los bytes. En esa segunda prueba se sustituyeron el deserializador y la barrera del recolector por funciones de prueba; no se ejecutó una sesión ni se validó la longitud real de la clave. El SHA-256 del cliente se comprobó antes de utilizar las direcciones. Estas pruebas confirman el recorrido del array, no recuperan su contenido en la partida.

La revisión de las capturas ahora observa los mensajes completos, incluidos los reconstruidos a partir de fragmentos. Con la política original del parser se observan 643 mensajes cifrados completos: 143 requests, dos responses y 498 eventos. Esto corrige la clasificación anterior de cabeceras candidatas sin reensamblar, que no era el recuento de mensajes completos entregados por el parser.

Se probó también, sólo en una copia privada de diagnóstico, continuar con el siguiente comando de límites válidos cuando falla la deserialización del anterior. Esta prueba encuentra dos eventos cifrados adicionales, ambos con cuerpo de 96 bytes: el total pasa a 645, con 143 requests, dos responses y 500 eventos. No se modificó el parser del radar. Ninguno de los cuerpos cifrados completos de esta prueba tiene una longitud que no sea múltiplo de 16; es una propiedad compatible con cifrado por bloques y no identifica por sí sola algoritmo o modo.

En las cinco respuestas `Join` aparecen dos eventos cifrados con cuerpo de 32 bytes dentro de los 250 ms anteriores a la respuesta, en la misma conexión direccional, peer y challenge. Son candidatos por proximidad temporal, no eventos `KeySync` identificados. Hay otros mensajes de 32 bytes durante las sesiones: tamaño y momento no bastan para atribuirles un código de evento.

No se decodificó ningún evento 603, tampoco al continuar después de los errores de valores. Una búsqueda adicional del marcador de short 603 en los cuerpos completos no cifrados obtuvo cero coincidencias, incluidas las rutas de deserialización fallida. Esta búsqueda auxiliar no sustituye una decodificación válida ni prueba que la sincronización no se transmitiera dentro de una envoltura cifrada. Los siete mensajes completos con fallo de deserialización de evento no proporcionaron una clave identificable.

La prueba de permisos se ejecutó primero sin elevación y después como administrador mediante un diagnóstico puntual. `OpenProcess` devolvió un handle en ambos casos, pero `EnumProcessModulesEx` falló con error Win32 5 (`Access denied`); no se localizó `GameAssembly.dll` en el proceso. No se ejecutó `ReadProcessMemory`. Por tanto, la elevación no resolvió la consulta y no se ha demostrado acceso a la memoria del cliente ni identificado la causa exacta del bloqueo. No se modificaron protecciones ni el proceso del juego. Los permisos de consulta y lectura son operaciones distintas en el [modelo de acceso de Windows](https://learn.microsoft.com/en-us/windows/win32/procthread/process-security-and-access-rights).

Esta investigación confirma la asociación de `KeySync` con el array usado para posiciones, pero no obtiene su contenido original ni la clave del cifrado Photon. La recuperación de máscaras efectivas que sigue utiliza otros eventos legibles y no depende de acceder a la memoria del juego.

## Recuperación de máscaras mediante hechizos: prueba con un solo cliente

El evento legible `CastSpell = 19` contiene un ID de emisor en el parámetro 0, un ID de objetivo en el 1 y dos float32 en el 2. La estructura del cliente instalado coincide con esas formas. Para eventos dirigidos al mismo ID (`p0 == p1`) de una entidad previamente observada como jugador, esos floats proporcionan un candidato de posición conocido. Se emparejan con sus bytes protegidos anteriores, conservando flujo direccional, interfaz, peer y challenge, y retirando entidades al recibir `Leave`.

Se calcula una máscara efectiva de ocho bytes mediante `M = C XOR P`, donde `C` son los ocho bytes protegidos y `P` son los dos floats legibles en little-endian. Un par aislado sólo propone una máscara: siempre puede construirse por esa fórmula. La comprobación útil aplica una máscara aprendida **antes** al ciphertext de pares posteriores y compara el resultado con sus floats legibles sin utilizar esos nuevos floats para actualizar la máscara primero.

La prueba exploratoria que acepta observaciones de hasta 250 ms obtiene 6/6 comparaciones exactas en A, 11/19 en B y 73/85 en la captura de inicio. Los ocho y doce fallos de B e inicio impiden usar esa política tal cual para dibujar jugadores. Pueden intervenir cambios de máscara y desfases entre movimiento y hechizo; no se atribuye una causa única a cada fallo.

La primera política estricta, con semillas sólo de aparición, produjo 72 comparaciones posteriores exactas, de las cuales una era de movimiento. Una variante con semillas sólo de movimiento produjo 20 comparaciones exactas, ocho de movimiento. Esos resultados se solapan y no se suman. La política final admite una aparición **o un movimiento** emparejado con un hechizo dirigido al mismo emisor, únicamente si ambos se reciben en **el mismo registro de datagrama**, con el mismo timestamp. Invalida la máscara ante cualquier evento Photon completo marcado como cifrado (`0x84`), sin afirmar que todos esos eventos sean `KeySync`. Evalúa los pares posteriores con una observación de antigüedad máxima de 250 ms antes de aprender otro par. Esta política es conservadora, pero no demuestra que detecte todas las rotaciones posibles.

| Captura | Semillas estrictas | Invalidaciones por evento opaco | Comparaciones posteriores | Exactas / fallidas | Aparición / movimiento exactos |
| --- | ---: | ---: | ---: | ---: | ---: |
| A, adjunta del escritorio | 2 | 1 | 5 | 5 / 0 | 5 / 0 |
| B, adjunta de Documentos | 10 | 10 | 9 | 9 / 0 | 1 / 8 |
| Inicio de sesión, 14361 registros | 17 | 15 | 69 | 69 / 0 | 68 / 1 |
| Primera prueba adicional durante la partida, 5025 registros | 2 | 2 | 0 | 0 / 0 | 0 / 0 |
| Segunda prueba adicional durante la partida, 4602 registros | 0 | 0 | 0 | 0 / 0 | 0 / 0 |

La política final obtiene **83 comparaciones posteriores exactas y cero fallidas dentro de las ventanas admitidas**. Sesenta y ocho corresponden a un ID distinto del que aportó la semilla; cuarenta corresponden además a bits de posición distintos. Son comparaciones de eventos, sin deduplicar retransmisiones, no 68 jugadores únicos. Las ventanas descartadas y las observaciones sin máscara no se cuentan como éxitos. Las dos pruebas adicionales actuales no aportaron comparaciones posteriores válidas.

Los pares exitosos se repitieron con las instrucciones originales de la rutina nativa `n7`, RVA `0x8CF2A0`: **166 lecturas de float32 coincidieron bit a bit**. Además se identificó el consumidor de aparición `csa.v`, RVA `0xBE9820`: divide el array del parámetro 16 en dos bloques de cuatro bytes, aplica `e0.a` con offsets de clave 0 y 4 y reconstruye los floats. Su helper XOR, RVA `0x8DFE00`, produjo **148 coincidencias exactas** en los 74 pares de aparición. La emulación utiliza un array sintético que contiene la máscara efectiva recuperada; no demuestra que el array original recibido por `KeySync` tenga esa longitud. El hash del cliente se comprueba antes de utilizar estos RVA.

La primera captura adicional durante la partida terminó normalmente tras cuatro minutos, con 5025 paquetes y cero pérdidas registradas por `dumpcap`. Su SHA-256 es `F0514214E819523B40C4EEFB644FF12CB90561C7D17392CFADBF6B3580BA3FDA`. Aportó seis hechizos propios, tres de emisores observados como jugadores y tres pares candidatos de movimiento. Dos tenían antigüedad cero y sirvieron como semillas de movimiento, pero ambas máscaras se invalidaron ante eventos cifrados antes de disponer de un par posterior. La política exploratoria hizo una comparación posterior y falló. Esta muestra **no amplía las comparaciones validadas** y demuestra que no basta con obtener un candidato aislado mientras se juega.

La segunda captura adicional terminó tras otros cuatro minutos, con 4602 paquetes y cero pérdidas registradas por `dumpcap`. Su SHA-256 es `37C3450AB0707B87A9AF5267D50DF06A52E36029DE62CAE3974F17D3EFFD7AE8`. No aportó eventos de hechizo propio utilizables por esta prueba; tampoco nuevas máscaras o comparaciones posteriores. El usuario continuó en su zona habitual.

La vía encontrada no requiere un segundo PC y no descifra el cifrado de Photon: aprovecha coordenadas legibles de otro evento para recuperar los ocho bytes efectivos necesarios para esos pares. No se extrajo ningún array original de `KeySync`, no se recuperó una clave AES/DH y no se accedió a la memoria del juego. Las máscaras, las coordenadas, los IDs y los fixtures de comprobación se mantienen privados.

El resultado acredita recuperación en ventanas concretas y exige ampliar la prueba de movimiento: de las 83 comprobaciones de la política final, nueve son de `Move`. Aún no se han contrastado marcadores con la ubicación visible de jugadores en el juego. Una versión que dibuje posiciones necesita corroborar cada máscara con pares independientes, retirarla ante cambios o pérdida de confianza y disponer de validación continua de movimientos. La entrega V7.3.2 no incorpora todavía este aprendizaje ni un descifrador operativo.

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

Los resultados detallados del análisis inicial quedan localmente en `.build/qa/encryption-20261007/`, excluidos de Git. La investigación posterior del cliente y la verificación nativa quedan igualmente locales, sin subir software del juego ni capturas privadas. Los dos EXE seleccionados, V7.3.2 y V7.3.1-Old, conservan sus versiones y hashes verificados. Se confirmó la rutina XOR con datos sintéticos y se contrastaron 83 pares posteriores de las capturas con coordenadas legibles de hechizos. Siguen pendientes una validación visual en el mapa, cobertura suficiente de movimiento continuo y la recuperación del array original de `KeySync` o de la clave Photon.
