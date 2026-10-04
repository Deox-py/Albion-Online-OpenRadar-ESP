# QA V7.1.2

Objetivo: corregir el único fallo observado después de que V7.1.1 completara 823/823 tests y typecheck en Windows: ESLint `no-undef` sobre el harness `tools/qa-v7-smoke.mjs`.

Validaciones de esta entrega:

- QA estático offline.
- Smoke funcional V7.1.
- `node --check` sobre JS/MJS.
- Guardia estática de configuración ESLint para `.mjs` + globals Node/browser.
- Integridad del ZIP y repetición de QA desde una extracción fresca.

La suite completa de Vitest/lint/typecheck seguirá ejecutándose automáticamente en Windows mediante `COMPILAR-PORTABLE.bat`.
