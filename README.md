# OpenRadar 2.3ESP_Deox V7.3.2

Radar para Albion Online con interfaz en español. Captura pasiva de paquetes mediante Npcap/libpcap, parser Photon en Go y visualización local en el navegador.

La raíz de este repositorio contiene las fuentes del radar **V7.3.2, sin automatización**. Incluye mejoras de zoom, contexto inicial de mapa, diagnóstico y cofres observados. No contiene control de ratón o teclado, bots ni un descifrador de posiciones de jugadores. Consulta el [informe V7.3.2](docs/releases/INFORME-V7.3.2-COFRES.md) y el [índice de documentación](docs/README.md).

## Qué muestra

Recursos estáticos y vivos, mobs, pesca, mazmorras, Mists, jaulas, cofres y una lista de jugadores con equipamiento y alertas. Dispone de perfiles, modo compacto, FPS configurables y agrupación de recursos.

- **Cofres:** filtros por Avalon, campamentos, pequeños tesoros y otros, además de «Rareza desconocida». Los cofres observados con posición válida pueden dibujarse con un símbolo neutro. Para ver un cofre sin rareza conocida deben estar habilitados su familia y «Rareza desconocida».
- **Estado de cofres:** conserva tipo, modelo y estado recibido sin convertir números o nombres ambiguos en una rareza. Una señal de apertura no demuestra que esté vacío. La salida del objeto, el cambio de zona y el reset limpian los marcadores.
- **Zoom:** rueda sobre el radar, botones y deslizador entre 10 y 300 %, también en pantallas pequeñas. La escala se guarda y se sincroniza entre pestañas.
- **Mapa al conectar:** el navegador recibe el contexto que el servidor ya observó. Si la captura comenzó después de entrar a la zona, puede elegirse una zona conocida manualmente; la UI distingue esa elección hasta recibir contexto capturado. Las instancias dinámicas necesitan su identificador observado.
- **Diagnóstico:** Configuración → Red muestra tramas truncadas, errores de decodificación y fragmentos IPv4 omitidos. El inspector opcional revisa eventos recientes y permite exportarlos a JSONL; incluir parámetros requiere una opción separada.

El radar sólo conoce entidades que el servidor haya anunciado y que la captura pueda interpretar. No revela cofres aún no anunciados ni acredita rareza oculta. Los mensajes cifrados se reconocen y se omiten: sin claves válidas no se interpretan como posiciones. Las posiciones exactas de otros jugadores no se dibujan.

La [revisión de cifrado del 7 de octubre de 2026](docs/technical/PLAYER_POSITION_ENCRYPTION_AUDIT_2026-10-07.md) distingue los modos documentados de Photon de lo observado en dos capturas, explica el contador `Encrypted traffic seen` y analiza los errores de longitud. No acredita un descifrador de posiciones.

Cuando se pierde la conexión o se saturan las colas, se descarta el estado incompleto y se muestra un aviso. Las entidades persistentes pueden necesitar un cambio de zona para volver a anunciarse; la captura pasiva no solicita al juego una instantánea.

## Compilar en Windows

Ejecuta **`COMPILAR-PORTABLE.bat` desde esta carpeta**. En la primera ejecución usa el builder sin `-NoInstall`: comprueba Go 1.27+, Node.js 24+, MinGW y Npcap SDK, prepara la caché de herramientas y ejecuta los controles de calidad antes de compilar. Puede descargar dependencias y solicitar confirmación de Windows/winget para instalar herramientas que falten. El caché se guarda en `%LOCALAPPDATA%/OpenRadar-Deox/build-cache`.

`COMPILAR-AUTOMATICO.bat` es un acceso equivalente. Reserva `COMPILAR-LIMPIO.bat` para problemas de dependencias: elimina `node_modules` y el caché compartido de herramientas para reconstruirlos.

Para preparar una salida provisional sin sustituir una entrega anterior:

```powershell
.\AUTO-BUILD-2.3ESP_Deox.ps1 -OutputDirectory 'dist/.staging/V7.3.2'
.\tools\windows-build\verify.ps1 -Directory 'dist/.staging/V7.3.2'
```

Con las herramientas ya preparadas puedes añadir `-NoInstall`:

```powershell
.\AUTO-BUILD-2.3ESP_Deox.ps1 -NoInstall -OutputDirectory 'dist/.staging/V7.3.2'
```

`-NoInstall` no prepara las herramientas que falten; exige disponer de ellas en el sistema o en el caché. El builder genera un paquete técnico con launcher, ZIP del núcleo, notas y checksums. La organización de una entrega local deja en `dist/` sólo el EXE actual con versión y el anterior marcado `-Old`; el paquete técnico y los respaldos se conservan en `.build/`. Consulta [distribución Windows](docs/technical/WINDOWS_RELEASE.md) y las [reglas de entrega](AGENTS.md).

Estas instrucciones parten de la raíz del repositorio y no necesitan otro árbol de fuentes. La presencia de las fuentes y los informes no implica que haya un binario o una release V7.3.2 publicados en GitHub.

## Ejecutar el radar compilado

Npcap es una dependencia externa de ejecución. El SDK usado para compilar no sustituye el driver instalado en Windows. El launcher comprueba su disponibilidad y, si falta, pide confirmación antes de descargar e iniciar el instalador oficial; no se redistribuye ese instalador.

1. Cierra la versión anterior y abre el EXE compilado. El ZIP directo permite extraer `OpenRadar-core.exe` y ejecutarlo con Npcap ya instalado.
2. Abre `http://localhost:5001` y revisa Configuración → Red para seleccionar las interfaces de captura.
3. Comprueba el mapa y, para cofres, habilita las familias deseadas y «Rareza desconocida».

`--lan` permite visualizar el radar desde la red local; las operaciones de escritura del backend siguen restringidas al equipo anfitrión. `-no-open` evita abrir automáticamente el navegador y `-version` muestra la versión.

La firma Authenticode es opcional y requiere un certificado de firma de código válido con su clave privada. Metadatos, hashes y firma no garantizan aceptación por antivirus, SmartScreen ni ausencia de sanciones de Albion. Las [fuentes oficiales citadas en la revisión](docs/releases/INFORME-V7.3.1-RADAR.md) incluyen restricciones sobre herramientas de ventaja injusta.

## Verificar en Windows

Después de preparar las herramientas con el builder, ejecuta desde la raíz:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run qa:build
npm.cmd run test:go
npm.cmd run test:race
npm.cmd run qa:browser
```

`test:go` y `test:race` configuran MinGW/Npcap SDK desde el caché preparado. `qa:browser` compila el servidor de replay y usa Edge o Chrome instalado; puede seleccionarse otro ejecutable mediante `OPENRADAR_QA_BROWSER`. No abre Albion ni captura tráfico en vivo. Con Python disponible también puedes ejecutar:

```powershell
python tools/qa-static.py
node tools/qa-v7-smoke.mjs
```

El replay recorre PCAP anonimizado → Photon → WebSocket → navegador y añade una secuencia de cofres sintética identificada como tal. Sus pruebas cubren dibujo, filtros, limpieza, zoom y navegación; no acreditan compatibilidad completa con una sesión actual de Albion. Los resultados históricos del [informe V7.3.2](docs/releases/INFORME-V7.3.2-COFRES.md) corresponden a la sesión allí fechada.

## Organización

- `cmd/radar`: núcleo de la aplicación.
- `cmd/launcher`: launcher portable y metadatos.
- `internal`: captura, Photon, servidor, audio, plantillas y consola.
- `web`: UI, catálogos locales y recursos visuales.
- `tools`: actualizadores, diagnóstico, replay, QA y build.
- `docs/releases`: informes de versiones; los anteriores se conservan como historial.
- `docs/history`: notas y QA anteriores, incluida documentación del upstream.
- `docs/technical`: protocolo, diagnóstico, empaquetado y revisiones de referencias.

Los datos de usuario se guardan en `%LOCALAPPDATA%/OpenRadar-2.3ESP_Deox`, separados del ejecutable. Los catálogos pueden actualizarse explícitamente desde un commit fijado, con hashes de procedencia. No publiques `node_modules`, `.build`, `build-logs`, datos del usuario ni capturas privadas.

## Origen y licencia

Basado en [Nouuu/Albion-Online-OpenRadar](https://github.com/Nouuu/Albion-Online-OpenRadar), licencia MIT. Se conserva la atribución original en [LICENSE](LICENSE). Las [revisiones de proyectos de referencia](docs/technical/REFERENCE_PROJECTS_REVIEW.md) distinguen el código inspeccionado de las funciones anunciadas por sus autores.
