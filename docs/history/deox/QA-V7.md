# QA — OpenRadar 2.3ESP_Deox V7

Fecha: 2026-09-30

## Resultado de esta preparación

PASS en los gates que pueden ejecutarse offline en este entorno:

1. `node --check` sobre 97 archivos JS/MJS: **97/97 PASS**.
2. `python3 tools/qa-static.py`: **11/11 grupos PASS**.
3. `git diff --check`: **PASS**.
4. `node tools/qa-v7-smoke.mjs`: **7/7 grupos funcionales PASS**.
5. Assets de Mists `mist_0` … `mist_4`: **5/5 presentes**.
6. Revisión de archivos temporales/backup accidentales: **ninguno**.

## Smoke funcional V7

El smoke importa y ejecuta los módulos reales del proyecto y cubre:

- Event 40 y Event 39 de recursos, coordenadas envueltas, upsert y rango de retención.
- Rechazo atómico de batches incompletos.
- Wisp/Mist post-Dragonfire, clamp E0–E4 y deduplicación.
- Caché de jugadores independiente del límite visual.
- `MistsPlayerJoinedInfo` con `originCluster` explícito.
- Resolver de asset para subzonas numéricas.
- Defaults de Mists/jaulas desde perfil limpio, actualización de duplicados y rechazo de coordenadas inválidas.

Comando:

```bash
node tools/qa-v7-smoke.mjs
```

Salida esperada:

```text
QA V7 smoke: 7 grupos OK
```

## Gate oficial del repositorio no ejecutado aquí

El ZIP exige Node.js >=24 y Go >=1.27 para el gate oficial. El entorno de preparación tiene Node 22.16.0 y Go 1.23.2 y no dispone de las dependencias npm instaladas. Por eso no se marca falsamente como ejecutado:

```bash
npm ci
npm test
npm run lint
npm run typecheck
go test ./...
```

El último resultado real documentado en V5 fue 819/819 Vitest PASS y typecheck PASS, pero ese resultado pertenece a V5 y no se atribuye a V7.

## Validación recomendada al compilar en Windows

Ejecutar `COMPILAR-PORTABLE.bat`. El builder mantiene el onboarding visible de Npcap y debe ejecutar sus gates antes de producir el EXE. Después, probar una sesión real con logs para confirmar los payloads del servidor actual.

## Alcance de seguridad

V7 no añade inyección en el proceso del juego, lectura de memoria, MITM, hooks, ocultación de proceso ni evasión del anti-cheat. Esto no constituye una garantía frente a sanciones o cambios en las reglas del juego.
