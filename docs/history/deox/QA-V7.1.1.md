# QA V7.1.1

Hotfix del builder MinGW.

Validación en el entorno de empaquetado:

- `tools/qa-v7-smoke.mjs`: 7/7 grupos OK.
- `tools/qa-static.py`: 12/12 grupos OK, incluyendo guardia de orden PATH -> GCC y prueba C mínima.
- Verificación de sintaxis de JS/MJS y contenido del paquete heredada de V7.1.
- El builder de Windows hará la prueba real de GCC y la suite completa antes de generar el EXE.

Limitación: este entorno Linux no puede ejecutar el toolchain MinGW portable de Windows; la prueba real se ejecuta automáticamente al abrir `COMPILAR-PORTABLE.bat` en Windows.
