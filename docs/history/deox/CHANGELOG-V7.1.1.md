# OpenRadar 2.3ESP_Deox V7.1.1

## Builder / MinGW hotfix

- Corrige la validación de GCC del builder incremental: `mingw64\bin` y `usr\bin` se añaden al `PATH` **antes** de ejecutar GCC.
- La validación ya no se limita a `gcc --version`: compila y enlaza un programa C mínimo para comprobar `cc1`, assembler, linker y runtime.
- Si el toolchain está incompleto, Pacman verifica/repara `gcc`, `binutils` y `gcc-libs` y repite la prueba.
- El error final incluye diagnóstico útil en el log en vez de sólo indicar que `gcc.exe` no funciona.
- Reutiliza la caché compartida creada por V7.1; no debería volver a descargar MSYS2 si ya quedó extraído.

No cambia la captura de red ni la lógica del radar respecto a V7.1.
