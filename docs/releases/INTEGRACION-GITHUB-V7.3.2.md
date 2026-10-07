# Integración de las fuentes V7.3.2 para GitHub

Revisión del 4 de octubre de 2026, America/Sao_Paulo. Repositorio: `Deox-py/Albion-Online-OpenRadar-ESP`; base: `main` en `91380731d282b8acc4d1ca9078fb2eafcd48fd25`.

Se integraron las fuentes seleccionadas del radar V7.3.2, sus pruebas y herramientas de compilación. Las mejoras funcionales de captura, zoom, contexto de mapa y cofres se describen en el [informe V7.3.2](INFORME-V7.3.2-COFRES.md). Esta integración mantiene la versión `2.3ESP_Deox-V7.3.2` y los metadatos Windows `2.3.0.732`.

## Ajustes para publicar y compilar

- README e instrucciones parten de un clon limpio de este fork. Los informes anteriores se conservan como historial y se retiraron rutas personales de la documentación.
- Las notas antiguas de la raíz se agruparon en `docs/history`. Los logs, respaldos, dependencias, capturas privadas y binarios generados quedan fuera de Git y del contexto Docker.
- Los 22 PCAP de regresión tienen los mismos SHA-256 que los fixtures ya publicados en la base del fork; no se añadieron capturas de una sesión personal.
- El builder respeta primero las herramientas seleccionadas por el llamador. Esto evita que Go o Node antiguos del sistema oculten las versiones preparadas por GitHub Actions. Una prueba reproduce el fallo anterior y verifica la resolución del ejecutable elegido.
- Se corrigió la preparación de MinGW desde cero: la salida de progreso de MSYS2/pacman contaminaba el valor que debía contener sólo la ruta de GCC. La ejecución nativa verifica su código de salida y escribe el progreso en consola. Una regresión con un proceso real reproduce el fallo y pasa después de la corrección.
- La prueba de zoom heredada del fork comprueba los límites del HTML contra el normalizador real, después de extraer el controlador del template.
- Se resolvieron avisos del linter de Go con cambios equivalentes y retirando un método sin llamadas. Las excepciones de análisis de seguridad son locales y explican sus rutas o llamadas; no se deshabilitaron reglas globalmente. Se conservó el texto español de la interfaz.
- CI añade typecheck, detector de carreras, replay offline y compilación/verificación portable Windows. Los workflows se validaron con actionlint 1.7.12.
- El workflow de release valida un tag existente contra `AUTOBUILD-VERSION.txt`, usa el builder Windows y verifica sus recursos y payload. Genera checksums de los archivos finales y crea un borrador de release; no deriva la versión numérica del prefijo `v`.

## Verificación local del árbol preparado

| Comprobación | Resultado |
| --- | --- |
| Frontend | 972 tests aprobados, 0 fallos |
| ESLint y TypeScript | Aprobados |
| Go | `go test -race -count=1` en raíz, `cmd`, `internal` y `tools`, aprobado |
| golangci-lint 2.13.2 | Aprobado, 0 diagnósticos; avisos heredados de exclusiones sin coincidencias |
| QA estático y funcional | 12 y 7 grupos aprobados |
| Packaging Windows | 15 pruebas aprobadas, incluidos recursos reales, prioridad del toolchain y preparación limpia de MinGW |
| Navegador offline | PCAP → Photon → WebSocket → UI, cofres sintéticos identificados, filtros, mapa, zoom, reset y navegación aprobados |
| Compilación Windows | Launcher portable y núcleo compilados; integridad, metadatos y núcleo embebido verificados |

Los controles se ejecutaron localmente en Windows. La validación de sintaxis de los workflows no equivale a haber ejecutado GitHub Actions; su resultado remoto debe comprobarse en la PR. El build de comprobación reutiliza herramientas preparadas y omite repetir los controles del builder mediante `-SkipQA`, después de ejecutar por separado las pruebas anteriores.

No se modifica la rama de la PR histórica #1 durante esta preparación. La integración parte de `main`; las propuestas de esa PR siguen siendo una revisión separada.

## Límites de la entrega

La rama contiene sólo radar, sin automatización de movimiento, combate o recolección. Los mensajes cifrados siguen omitiéndose sin una clave válida y no se dibujan coordenadas exactas de otros jugadores. Los cofres requieren que el servidor los anuncie y no se inventa rareza a partir de estado bruto.

Estas pruebas usan fixtures y secuencias sintéticas; no validan una partida actual de Albion. El build local no está firmado. No se garantiza aceptación por antivirus, SmartScreen ni ausencia de sanciones. La publicación de fuentes no implica que exista una release descargable; la entrega local seleccionada conserva sus dos EXE y sus hashes anteriores.
