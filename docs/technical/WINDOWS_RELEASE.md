# Compilación y distribución Windows V7.3.2

Ejecuta los comandos desde la raíz de estas fuentes. `AUTOBUILD-VERSION.txt` declara `V7.3.2`; el producto de launcher y núcleo es `2.3ESP_Deox-V7.3.2` y la versión numérica Windows es `2.3.0.732`. Esta línea contiene sólo radar.

## Primera compilación y herramientas

`COMPILAR-PORTABLE.bat` llama al builder sin `-NoInstall`. Comprueba Go 1.27+, Node.js 24+, MinGW y Npcap SDK, e intenta preparar las herramientas ausentes. Go y Node pueden requerir winget o instalación manual. MinGW y Npcap SDK se reutilizan desde `%LOCALAPPDATA%/OpenRadar-Deox/build-cache`. Se comprueban las dependencias npm y Go antes de compilar.

Para generar una salida provisional y verificarla sin sustituir binarios anteriores:

```powershell
.\AUTO-BUILD-2.3ESP_Deox.ps1 -OutputDirectory 'dist/.staging/V7.3.2'
.\tools\windows-build\verify.ps1 -Directory 'dist/.staging/V7.3.2'
```

Con las herramientas preparadas, `-NoInstall` impide instalar o preparar las que falten:

```powershell
.\AUTO-BUILD-2.3ESP_Deox.ps1 -NoInstall -OutputDirectory 'dist/.staging/V7.3.2'
```

La salida personalizada debe permanecer dentro de `dist/`. Sin `-OutputDirectory` se utiliza `dist/` directamente. `BUILD-2.3ESP_Deox.ps1` delega en el mismo pipeline. `-SkipQA` omite controles de calidad y no sirve para documentar una compilación verificada. `-Clean` elimina `node_modules` y el caché compartido de herramientas; úsalo sólo cuando sea necesario reconstruir las dependencias.

## Paquete técnico y entrega local

El builder produce estos archivos intermedios en el directorio de salida:

- `OpenRadar-2.3ESP_Deox.exe`: launcher portable que incorpora el núcleo compilado.
- `OpenRadar-2.3ESP_Deox.zip`: paquete del launcher.
- `OpenRadar-2.3ESP_Deox-direct-windows-amd64.zip`: núcleo directo, `LEEME.txt`, `LICENSE.txt` y checksums internos.
- `RELEASE.txt`, `SHA256.txt` y `SHA256SUMS.txt`: identidad del build y comprobaciones de integridad.

Npcap es una dependencia externa para ejecutar ambos formatos. El SDK de compilación no instala el driver. El launcher ofrece descargar e iniciar el instalador oficial con confirmación si Npcap falta; el ZIP directo requiere tenerlo instalado. No se redistribuye su instalador.

Después de verificar el paquete provisional, conservarlo y guardar sus evidencias bajo `.build/`. La entrega local organizada según [CONTRIBUTING.md](../../CONTRIBUTING.md) deja en `dist/` únicamente:

```text
OpenRadar-2.3ESP_Deox-V7.3.2.exe
OpenRadar-2.3ESP_Deox-V<version-anterior>-Old.exe
```

El nombre Old identifica un EXE anterior existente; no se genera a partir de una copia del actual. Conservar versiones más antiguas y respaldos fuera de `dist/`. Copiar o renombrar el launcher no cambia sus bytes: verificar hashes y versión antes y después. Una recompilación de V7.3.2 no debe desplazar otra versión a Old. La regla local de dos EXE no declara un formato de publicación de GitHub ni acredita que ya exista una release pública.

## Metadatos, firma e integridad

El builder genera recursos Windows con `windres.exe` del MinGW preparado. Verifica producto, versión numérica, icono y manifiesto realmente enlazados, y rechaza imports PE de DLL privadas del compilador que no se distribuyen. El manifiesto solicita `asInvoker` y declara `PerMonitorV2, PerMonitor`. [windres](https://sourceware.org/binutils/docs/binutils/windres.html), [manifiestos de Windows](https://learn.microsoft.com/en-us/windows/win32/sbscs/application-manifests).

`AUTOBUILD-VERSION.txt`, los dos `versioninfo.json` y el manifiesto deben actualizarse juntos al cambiar de revisión. Si texto del producto y metadatos difieren, falla la comprobación.

Sin parámetros de firma, el EXE queda con Authenticode `NotSigned`; no se crea un certificado. Firmar requiere un certificado válido de firma de código con acceso a su clave privada y SignTool del Windows SDK:

```powershell
.\AUTO-BUILD-2.3ESP_Deox.ps1 -NoInstall -OutputDirectory 'dist/.staging/V7.3.2' `
  -CertificateThumbprint 'HUELLA_HEXADECIMAL_DE_40_DIGITOS' `
  -SignToolPath 'RUTA_AL_SIGNTOOL_DEL_WINDOWS_SDK' `
  -TimestampUrl 'https://SERVIDOR_RFC3161_DEL_EMISOR'
```

Los valores del ejemplo son marcadores que deben sustituirse por datos reales. Por defecto se usa `CurrentUser\My`; `-CertificateStoreLocation LocalMachine` selecciona `LocalMachine\My`. No pasar contraseñas PFX en la línea de comandos.

Se firma primero el núcleo y después el launcher que lo incorpora. Se usa SHA-256 y se comprueba `signtool verify /pa /all /v`, `Get-AuthenticodeSignature`, la huella esperada y el timestamp solicitado. Un error aborta la publicación; no se reemplaza una firma fallida por una salida sin firma. Sin `-TimestampUrl` no hay sello de tiempo. [Opciones oficiales de SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool).

`SHA256SUMS.txt` registra los bytes finales, después de firmar si procede, y excluye su propio contenido. El verificador comprueba hashes externos e internos, identidad exacta del núcleo embebido, recursos Windows y `--version` de ambos ejecutables. Los hashes identifican bytes; se necesita una fuente confiable para autenticar al editor.

Metadatos y firma no garantizan aceptación por SmartScreen, antivirus ni anti-cheat. Las pruebas del builder tampoco acreditan compatibilidad con una partida en vivo. El pipeline no utiliza UPX, ofuscación ni técnicas de evasión.

## Repetición y recuperación

El ZIP ordena sus entradas, utiliza `/` y fija timestamps al 1 de enero de 2020. Puede fijarse `SOURCE_DATE_EPOCH` a un entero de segundos UTC para estabilizar Build UTC. La repetición exacta depende también de Go, MinGW, dependencias y recursos; las firmas o sellos de tiempo pueden cambiar los bytes.

El builder sustituye temporalmente `payload.bin` y recursos `.syso`, y los restaura mediante `finally`. El `payload.bin` fuente es un placeholder: compilar sólo `cmd/launcher` no produce una distribución funcional. El builder debe compilar e incorporar el núcleo. Una interrupción forzada puede impedir la restauración; conservar staging y respaldos para recuperar los originales.

La salida técnica se prepara después de los controles y se copia al directorio elegido. La copia de varios archivos no es una transacción atómica del directorio: un fallo de disco puede dejar un paquete parcial. Verificarlo antes de compartir y recuperar la entrega anterior desde su respaldo si hace falta. No borrar fuentes o respaldos para limpiar temporales.

Los contratos de empaquetado se ejecutan con `npm.cmd run qa:build`. Para tests del radar, carreras e integración en navegador, consulta los [comandos Windows](../../README.md#verificar-en-windows). Las evidencias de sesiones anteriores se describen en los informes históricos y no se incluyen como logs privados en este repositorio.
