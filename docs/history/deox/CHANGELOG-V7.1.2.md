# OpenRadar 2.3ESP_Deox V7.1.2

## Builder / lint hotfix

- Corrige el fallo de ESLint en `tools/qa-v7-smoke.mjs`.
- El smoke offline es un harness Node que crea mocks de `window`, `localStorage` y otros globals del navegador; ahora ESLint lo configura explícitamente como entorno mixto Node + browser.
- Amplía la regla de herramientas Node para incluir `.mjs`, no sólo `.js`.
- Añade una guardia de regresión en `tools/qa-static.py` para impedir que esta configuración desaparezca en futuras versiones.
- No cambia la lógica de detección/radar respecto de V7.1.1.
