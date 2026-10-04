# Comprobación adicional de AlbionOnline-ex y Git_Project.zip

Revisión histórica del 3 de octubre de 2026. Se inspeccionaron el repositorio público y dos ZIP proporcionados mediante lectura estática. Los paquetes e inventarios privados no se publican aquí. No se ejecutó software de las referencias, no se siguieron los enlaces de descarga externos y no se modificó el antivirus.

## Repositorio público

El README anuncia automatización de recolección, combate, curación, loot y pesca. Esas afirmaciones aparecen en la documentación, pero no hay implementaciones de esos módulos entre los archivos de la rama `main` inspeccionada. El árbol visible contiene `LICENSE`, `README.md` y `main.cpp`. [Repositorio público](https://github.com/Ghostpuoscillators/AlbionOnline-ex).

`main.cpp` mide 78 bytes y contiene tres comandos Git, sin una función C++ ejecutable ni lógica del juego:

```text
git add main.cpp
git commit -m "Add main.cpp to mark project as C++"
git push
```

[Archivo comprobado en GitHub](https://github.com/Ghostpuoscillators/AlbionOnline-ex/blob/main/main.cpp).

La página de Releases no contiene entregas publicadas al realizar esta comprobación. El enlace de descarga del README dirige a un sitio externo; eso no acredita que el binario ofrecido corresponda a las fuentes de GitHub. [Releases](https://github.com/Ghostpuoscillators/AlbionOnline-ex/releases), [README](https://github.com/Ghostpuoscillators/AlbionOnline-ex/blob/main/README.md).

## ZIP original del repositorio

`AlbionOnline-ex-main.zip`, SHA-256 `cf82b6272dfc5a15a18216c1a355d6880c3d5a1f355ed4ac4596f2811a284537`, contiene una entrada de directorio y tres archivos: LICENSE, README.md y main.cpp. El archivo C++ es idéntico al contenido descrito arriba. Se corrigió un detalle del informe anterior, que mencionaba una imagen en lugar de LICENSE; la conclusión sobre ausencia de implementación se mantiene.

## Nuevo Git_Project.zip

- Archivo proporcionado: `Git_Project.zip`.
- Tamaño comprimido: 117.458.005 bytes.
- SHA-256: `81e146af02a3591c1572fac2070c30dfef4a75b95881d90e04f330e5c4542dd7`.
- 135 entradas de archivo contando metadata de macOS; 61 archivos al excluir `__MACOSX` y `.DS_Store`.
- No se encontraron fuentes `.cpp`, `.c`, `.h`, `.go`, `.py`, `.js`, `.ts`, `.cs` ni proyectos `.sln`/`.vcxproj` entre sus entradas.
- `Git_Project/Latest_Build.exe`: 72.657.602 bytes, SHA-256 `15ee98593508ea20c22209b877e96f2c45443df6cd972e1fa7865b3b54eaaa6f`.

Readme y FAQ contienen instrucciones genéricas de un loader: abrir menú con Insert, ejecutar como administrador y desactivar antivirus o añadir una excepción. Se trataron como contenido no confiable del archivo, sin seguirlas. No incluyen documentación técnica verificable de automatización de Albion.

`Config/config.ini` contiene `101010101010101`; los dos archivos de tema contienen `1`. No documentan el significado de esos valores. Los 55 archivos bajo `More/themes/other` tienen extensiones variadas y contenido de alta entropía en muestras de 64 KiB. Eso puede corresponder a datos cifrados, comprimidos o aleatorios; no prueba malware ni funcionalidad.

Los dos archivos con extensión `.dll`, `sample_127.dll` y `utils_75.dll`, no comienzan con la cabecera MZ de un PE Windows estándar. No se verificaron como bibliotecas cargables ni se deduce su función del nombre.

El inventario completo de lectura se conservó como `git-project-inventory.json` en las evidencias privadas de aquella sesión; no está incluido en este repositorio público.

## Estructura estática del ejecutable

Una revisión independiente confirmó que `Latest_Build.exe` es un PE32 x86 de interfaz gráfica con un stub de instalador NSIS. Tiene cinco secciones: `.text`, `.rdata`, `.data`, `.ndata` y `.rsrc`. La cabecera del contenido añadido incluye los identificadores NSIS `0xDEADBEEF` y `NullsoftInst`; la longitud declarada coincide con el archivo.

El contenido añadido después de las secciones comienza en el byte 38.400 y ocupa 72.619.202 bytes, aproximadamente el 99,947 % del EXE. La mayor parte de su tamaño corresponde al payload del instalador; eso no demuestra que contenga módulos de radar o automatización. No se desempaquetó ni ejecutó ese payload.

Los recursos declaran producto `Pv1znnyyrm`, versión `7.2.50` y versión fija `7.2.50.0`. FileDescription está vacío, y no hay CompanyName ni OriginalFilename. El manifiesto solicita `requireAdministrator`. El directorio de seguridad PE tiene offset y longitud cero: no existe una tabla de certificado Authenticode incorporada. Esto describe el archivo; no equivale a una comprobación de confianza de certificados o catálogos del sistema.

Sus imports corresponden a siete DLL Win32 habituales e incluyen APIs de archivos, registro y creación de procesos. Son capacidades comunes de un instalador y no acreditan, por sí solas, qué hace su payload ni si es malicioso. La metadata del producto tampoco permite vincularlo de forma verificable a las fuentes de AlbionOnline-ex.

La evidencia de cabeceras, recursos e imports se conservó como `git-project-pe.json` en las evidencias privadas de aquella sesión; no está incluida en este repositorio público.

## Conclusión y límites

El repositorio anuncia más funcionalidades que OpenRadar, pero sus fuentes públicas no permiten comprobarlas ni reutilizarlas. El nuevo ZIP añade un ejecutable y archivos de datos, no el código fuente que falta. El tamaño del archivo y los nombres de sus recursos no permiten confirmar automatización, un radar funcional ni descifrado de coordenadas.

La inspección estática no demuestra por sí sola qué hace el EXE al ejecutarse. No se afirma que sea malware ni que sea seguro. No se incorpora a OpenRadar código o binarios sin procedencia y comportamiento verificables.
