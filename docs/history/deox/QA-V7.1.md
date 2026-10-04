# QA V7.1 — Stability, Detection & Incremental Builder

Fecha: 2026-10-01

## Correcciones verificadas

- `DungeonsHandler` conserva `Parameters[3]` cuando existe y usa `[16]/[15]` solo como fallback Mist/Knightfall.
- Smoke funcional offline incluye guard explícito para la regresión `CORRUPTED_SOLO_NONLETHAL`.
- Builder incremental usa cache compartido en `%LOCALAPPDATA%\OpenRadar-Deox\build-cache`.
- MSYS2/MinGW y Npcap SDK se reutilizan entre versiones cuando ya están válidos.
- npm usa cache compartida + `--prefer-offline --no-audit --fund=false`.
- `node_modules` solo se regenera cuando falta/está incompleto o cambia `package-lock.json`.
- módulos Go se vuelven a preparar cuando cambia `go.mod`/`go.sum`.
- `COMPILAR-LIMPIO.bat` fuerza reconstrucción completa bajo demanda.
- el modo `-Clean` no intenta borrar la carpeta activa del transcript.
- QA offline + smoke corren antes de preparar MSYS2/Npcap/npm para fallar rápido.

## QA ejecutado en el entorno de preparación

- `node tools/qa-v7-smoke.mjs`: PASS — 7 grupos.
- `python tools/qa-static.py`: PASS — 12 grupos.
- `node --check` sobre 94 archivos JS no-vendor: PASS.
- `git diff --no-index --check` V7 → V7.1: sin errores de whitespace.
- `python -m py_compile tools/qa-static.py`: PASS.
- Comprobación de ausencia de `node_modules`, `.build`, `dist`, `build-logs`, backups y temporales en el paquete: PASS.

## Gate completo

El entorno de preparación usa Node 22 y Go 1.23, mientras que este proyecto declara Node 24+ y Go 1.27+.
Se intentó instalar la suite npm para repetir Vitest completa, pero el entorno no tiene acceso al registry npm (EAI_AGAIN), por lo que ese gate no se declara ejecutado aquí.

El builder V7.1 mantiene como gate oficial en Windows:

1. QA estático offline.
2. Smoke funcional offline V7.1.
3. Tests frontend (`npm test`).
4. TypeScript typecheck.
5. ESLint.
6. Go tests.
7. Build CSS/vendors.
8. Build núcleo Windows amd64.
9. Build launcher portable.
10. Smoke `--version` del EXE final.

Si cualquiera falla, el AutoBuild sale con código distinto de cero y no presenta la compilación como correcta.
