# V7.3.2 — cofres observados y estudio del cifrado

Fecha de la sesión documentada: 4 de octubre de 2026, America/Sao_Paulo. Línea sin automatización, basada en las fuentes verificadas de V7.3.1. La compilación local descrita se generó el 4 de octubre a las 07:08:55 UTC. Las fuentes V7.3.2 están en la raíz de este repositorio; el informe no afirma que ese binario esté publicado en GitHub.

## Cambios implementados

- Los cofres de campamentos y Avalon recibidos con posición válida se dibujan aunque su nombre no contenga una palabra de color. La rareza desconocida usa un símbolo neutro dibujado en canvas y no depende de descargar otro icono.
- Los 30 pequeños tesoros del catálogo pasan al handler de cofres. La comprobación exige nombre exacto y categoría `chest`; no duplica esos objetos como enemigos ni los somete al filtro de vida de mobs.
- Cinco filtros nuevos: rareza desconocida, Avalon, campamentos, pequeños tesoros y otros. Se habilitan inicialmente y respetan la preferencia persistida del usuario. Para ver un cofre de rareza desconocida deben estar habilitados tanto su familia como «Rareza desconocida».
- P3 se conserva como tipo lógico y P4 como modelo, sin sobrescribir uno con el otro. P5 y las actualizaciones de estado se conservan sin traducirlos a colores. Un spawn repetido actualiza coordenadas y metadatos sin añadir un duplicado.
- IDs y coordenadas inválidos se rechazan sin romper el flujo. Un evento `Leave` con un ID como `44junk`, un string numérico o un decimal no elimina por conversión el cofre numérico 44.
- La señal de apertura se registra sin asumir que el cofre está vacío. La salida del objeto, reset y cambio observado de zona limpian sus marcadores; las señales repetidas de la misma zona los conservan. Se corrigieron también las transiciones de mapa heredadas y de Nieblas que omitían esa limpieza.

Se conservan las mejoras de V7.3.1: zoom con rueda, botones y deslizador; contexto inicial de mapa; selección manual de zona; diagnóstico de captura e inspector opcional. No se añadió un temporizador que oculte cofres estáticos por llevar tiempo sin actualizaciones.

## Qué permite mejorar la evidencia

El objetivo es corregir cofres que el radar ya recibe pero pierde al clasificarlos o dibujarlos. El usuario confirmó pequeños tesoros de mundo abierto y cofres de campamentos, además de avalonianos.

La revisión reprodujo estos problemas con las clases locales:

- El fixture de campamento `KEEPER_DYNAMIC_CAMP_PERSONAL_SMALL_LC` se guardaba con posición pero no se dibujaba: el renderer sólo aceptaba palabras de color en el nombre.
- `AVALON_SMALL_SOLO_BASE` tampoco tenía una rama de dibujo. Algunas familias con `RARE` en su nombre admiten distintas rarezas de botín: el substring no demuestra su rareza actual.
- Los pequeños tesoros catalogados como `chest` pasaban al grupo de enemigos normales y podían quedar ocultos por el filtro de vida o de enemigos.
- Nombres ausentes podían romper el dibujo; posiciones mal formadas podían romper el handler. Un segundo spawn del mismo ID sólo actualizaba la fecha, conservando posición y metadatos anteriores.
- El renderer podía pintar verde un modelo de Nieblas que contiene `GREEN`, aunque ese término no acredita la rareza de su botín.

La clasificación de pequeños tesoros se fundamenta en 30 nombres del catálogo ya incluido: cinco tiers de `MOB_ROAMING_<FOREST|HIGHLAND|SWAMP|MOUNTAIN|STEPPE>_CHEST` y cinco `MOB_TN_FOREST_CHEST`. Se contrastaron con [mobs.json del commit de procedencia fijado](https://github.com/ao-data/ao-bin-dumps/blob/47e4f5aca4d30b7495afa5a625ce0d5795e32050/mobs.json), donde pertenecen a `hiddentreasures` y `chest`. Los IDs numéricos son posiciones del catálogo y pueden cambiar; el reconocimiento no debe depender de una lista fija de esos IDs.

Los `CD_HIDDEN_*` son otra familia; no se incorporan como tesoros de mundo abierto. Los drones avalonianos son mobs diferentes y no equivalen a un cofre de Roads.

## Rareza, apertura y desaparición

[lootchests.json del mismo commit](https://github.com/ao-data/ao-bin-dumps/blob/47e4f5aca4d30b7495afa5a625ce0d5795e32050/lootchests.json) define varios estados de rareza para una misma familia. `AVALON_SMALL_SOLO_BASE`, CHAMPION, BOSS, `AVALON_ELITE_RARE_MERGED` y el campamento Keeper no tienen un único color deducible del nombre. En esas familias se declara ocultación de rareza hasta el desbloqueo. El catálogo no demuestra qué parámetro de un paquete actual contiene esa rareza.

El [issue upstream de rareza #29](https://github.com/Nouuu/Albion-Online-OpenRadar/issues/29) contiene campos 5 con valores 4, 6 y 8. No se convierten en colores ni se presentan como una rareza validada. El tipo lógico y el modelo se conservan separados para impedir que una palabra de la zona cambie el color del botín.

Un [reporte de Abbey del 13 de septiembre, #211](https://github.com/Nouuu/Albion-Online-OpenRadar/issues/211) documenta spawn 393, actualizaciones 394 y apertura 395 para el mismo objeto. Justifica conservar el estado numérico como dato bruto y registrar la señal explícita de apertura. No demuestra una traducción universal de 6/7/8, ni que abierto signifique vacío. La desaparición debe seguir señales de salida y limpieza de zona/stream.

Los eventos `NewTreasureChest` 117, 41/42/43 y 285/286 existen en los enums, pero no se encontró un contrato de payload actual comprobado para incorporarlos. Usar un nombre de evento sin conocer sus campos podría generar posiciones falsas. La mejora no inventa objetos que el servidor todavía no haya anunciado.

## Investigación sobre descifrar el tráfico

El aviso `Encrypted traffic seen` se genera al reconocer la marca de cifrado de un paquete o mensaje Photon. El contador no identifica su contenido ni demuestra que ese mensaje incluya posiciones de jugadores.

La [documentación oficial actual de Photon](https://doc.photonengine.com/realtime/v5/reference/encryption) describe cifrado de payload mediante AES con una clave de 256 bits y mecanismos de intercambio por TLS o Diffie–Hellman. No establece qué configuración exacta usa hoy Albion. Del intercambio público de Diffie–Hellman no se obtiene directamente el secreto de sesión.

El [documento del mantenedor sobre posiciones](https://github.com/Nouuu/Albion-Online-OpenRadar/blob/69a76de885152492390a904c64fd4c1a7c241c50/docs/technical/PLAYER_POSITIONS_MITM.md) describe una segunda capa XOR y una clave distribuida en un mensaje protegido de Photon. También describe un proxy histórico. Son afirmaciones técnicas de esa revisión; no se validó aquí su cadena completa contra una sesión actual. En particular, su generalización a todo el tráfico no se adopta: nuestro corpus contiene mensajes legibles que el parser procesa sin claves.

El estudio previo de StatisticsAnalysis, Albion Lens, Camel y QRadar tampoco aportó un descifrador pasivo verificado para nuestra captura. Un extractor de archivos locales cifrados no descifra por ello el tráfico de red. Leer bytes como floats o aceptar números finitos tampoco acredita una posición real.

**Resultado:** no se encontró un método pasivo comprobado que proporcione las claves necesarias. Esta entrega no incluye un descifrador ni dibuja posiciones cifradas de jugadores. Para evaluar uno harían falta muestras actuales etiquetadas, material de clave válido y posiciones de referencia independientes, con coincidencia reproducible en varias sesiones. Los valores plausibles o una prueba AES con una clave inventada no resolverían esa falta de evidencia.

Las mejoras de cofres se apoyan en eventos legibles y en el catálogo local. No necesitan modificar la conexión del juego. No se añadieron proxy, lectura de memoria, inyección, control de ratón ni automatización.

## Validación histórica y entrega local

Los resultados siguientes corresponden a la sesión local indicada arriba, anterior a la preparación del repositorio público. Son evidencia histórica; una compilación nueva debe volver a ejecutar los comandos de QA del README. Los logs y capturas de esa sesión se conservaron de forma privada y no se publican en este repositorio.

| Comprobación | Resultado |
| --- | --- |
| Frontend completo | 971 pruebas aprobadas en 52 archivos |
| TypeScript y ESLint | Ambos con salida 0 |
| Tests Go | Todos los paquetes con tests aprobados |
| Go con detector de carreras | Aprobado, ejecución fresca con `-race -count=1` |
| QA estático | 12 grupos aprobados; se omite `git diff --check` porque el paquete no contiene `.git` |
| Smoke offline heredado | 7 grupos aprobados |
| Contratos de empaquetado | 13 pruebas aprobadas, incluyendo recursos de un EXE Windows real |
| Integración en Edge headless | Aprobada después de los cambios finales y de generar CSS/vendors |
| Integridad de launcher y núcleo | Hashes externos/internos, núcleo embebido exacto, versiones, manifiesto e icono verificados |

Las nuevas regresiones tuvieron comprobación RED→GREEN: el comportamiento anterior falló antes de implementar las correcciones. La revisión final añadió cobertura para IDs de salida mal formados y transiciones de zona. La suite completa se repitió dentro del builder antes de generar el binario.

La integración offline decodificó 25 paquetes del PCAP anonimizado existente y comprobó recurso, contexto previo a conectar el navegador, selección manual, rueda/botones, escala móvil, reset y navegación HTMX. Para cofres utilizó envelopes sintéticos por la cola y el router reales: campamento, Avalon y un pequeño tesoro buscado por nombre en el catálogo. Comprobó píxeles en las tres posiciones dibujadas, duplicados, estado, apertura, salida, limpieza y persistencia de filtros. No hubo errores de ejecución del navegador ni peticiones HTTP externas de la interfaz. Las ocho rutas/assets de automatización comprobadas devolvieron 404; su navegación y código están excluidos de esta línea.

Durante aquella compilación `npm ci` vació un directorio compartido mediante el enlace inicial de dependencias. Se restauró ese caché desde su lockfile, idéntico al de esta versión, y se prepararon dependencias propias para la copia de fuentes. Esta incidencia histórica no es un requisito del repositorio público: instalar dependencias desde su raíz con `npm.cmd ci`.

### Binarios de la sesión local

Estos tamaños y hashes identifican la entrega local anterior; no identifican una futura recompilación ni implican disponibilidad de descargas públicas.

| Archivo | Bytes | SHA-256 |
| --- | ---: | --- |
| `dist/OpenRadar-2.3ESP_Deox-V7.3.2.exe` | 71.881.216 | `e9572a37983f1329617cc36dd186fbff79d57369597f00865ba3b4fe1fa00023` |
| `dist/OpenRadar-2.3ESP_Deox-V7.3.1-Old.exe` | 71.875.072 | `fcb74ddefe3a2f48ff0369b5c867397b1f6a7ed3a8c5defc74af6a292c33df78` |
| ZIP directo técnico V7.3.2, fuera de `dist` | 52.686.052 | `20dcaa731950efc6247f90720a7650bb7dd7b57eadd270fae985e51c555645ce` |
| Núcleo V7.3.2 incluido en launcher y ZIP | 65.635.328 | `d33bd6896c007f9bdace11c89d69ab10825fb9c635fabd841ddab7324b3e3346` |

Producto: `2.3ESP_Deox-V7.3.2`; versión numérica Windows: `2.3.0.732`; manifiesto `asInvoker` y DPI `PerMonitorV2, PerMonitor`. Launcher y núcleo devuelven la misma versión y fecha de build con `--version`. Ambos siguen con Authenticode `NotSigned`: no se disponía de un certificado válido. El smoke del binario sólo ejecutó `--version`, sin arrancar captura sobre Albion.

### Organización y reproducción desde este repositorio

La entrega local documentada dejó únicamente el EXE V7.3.2 y V7.3.1 marcado Old en `dist`. Versiones anteriores, paquete técnico, checksums, fuentes respaldadas y evidencias se conservaron fuera de esa carpeta. Esos archivos privados no se incluyen en GitHub; los nombres de la tabla describen aquella entrega.

Para reproducir V7.3.2 utiliza la raíz de este repositorio. En la primera ejecución, `COMPILAR-PORTABLE.bat` prepara las herramientas necesarias sin `-NoInstall`. Para una salida provisional:

```powershell
.\AUTO-BUILD-2.3ESP_Deox.ps1 -OutputDirectory 'dist/.staging/V7.3.2'
.\tools\windows-build\verify.ps1 -Directory 'dist/.staging/V7.3.2'
npm.cmd run qa:browser
```

Puede añadirse `-NoInstall` cuando Go, Node, MinGW y Npcap SDK ya estén disponibles. Una vez verificado el paquete, organizar la entrega local conforme a [CONTRIBUTING.md](../../CONTRIBUTING.md): EXE actual con versión y anterior Old, conservando los auxiliares y respaldos en `.build/`. Para volver a ejecutar toda la validación, consulta el [README](../../README.md#verificar-en-windows).

Los fixtures de clasificación del catálogo y las secuencias del reporte upstream son sintéticos o derivados de extractos, no capturas nuestras realizadas hoy. El fixture de campamento incluido conserva un código histórico 391; las pruebas de router utilizan el enum 393 de esta revisión. Eso prueba el comportamiento del software para esas entradas, sin acreditar compatibilidad con todos los mensajes de la versión actual de Albion.

Para probar esta versión: cerrar la anterior, abrir el EXE V7.3.2 y revisar Cofres → «Rareza desconocida» y las familias deseadas. Sólo mostrará objetos que el servidor haya anunciado y que la captura pueda interpretar. No revela cofres aún no anunciados ni acredita la rareza oculta hasta desbloqueo. Falta validación con capturas actuales etiquetadas de campamentos, tesoros y Avalon; esa es la comprobación práctica pendiente, distinta de las pruebas del software. No se promete aceptación por antivirus ni ausencia de sanciones.
