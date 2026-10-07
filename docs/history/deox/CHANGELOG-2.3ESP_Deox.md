## V7.1.2 - Builder/lint hotfix

- Corrige `no-undef` de ESLint en el smoke offline (`window`, `localStorage`, `console`).
- Configura `qa-v7-smoke.mjs` como entorno Node + browser y añade cobertura de regresión.
- Sin cambios funcionales en la captura/detección respecto de V7.1.1.

# OpenRadar 2.3ESP_Deox — cambios

### Portable V4 / Npcap onboarding
- El artefacto final sigue siendo un único `OpenRadar-2.3ESP_Deox.exe`.
- Se añadió un bootstrapper sin dependencia de `wpcap.dll`, por lo que puede arrancar incluso si Npcap falta.
- Si Npcap no está instalado, pregunta al usuario antes de hacer nada.
- Con permiso, descarga el instalador directamente desde `npcap.com`, verifica Authenticode y lo ejecuta de forma visible.
- El núcleo del radar se extrae de forma versionada a `%LOCALAPPDATA%\OpenRadar-2.3ESP_Deox\bin\...`.
- Corregido `SettingsSync`: las eliminaciones entre pestañas ya no pueden rehidratar un valor obsoleto desde caché/storage.
- Actualizados contratos/tests de UI para la localización española.


Base: OpenRadar `v2.2.4-beta1`.

## Interfaz y experiencia

- Interfaz principal traducida al español.
- Navegación: Jugadores, Recursos, Enemigos, Cofres, Lista de ignorados y Configuración.
- Estados de conexión y mensajes del frontend en español.
- Nuevo **modo compacto** con salida rápida mediante `Esc`.
- Perfiles visuales rápidos: **Recolección**, **PvE**, **Exploración** y **Minimalista**.
- Ajuste de FPS objetivo y reducción automática de FPS cuando la pestaña está oculta.
- Clustering de recursos con radio adaptativo al zoom.
- Mejoras menores de etiquetas generadas dinámicamente (recursos y jugadores).

## Estabilidad y rendimiento

- Cola WebSocket limitada para impedir crecimiento de memoria durante ráfagas.
- Batching WebSocket desacoplado del goroutine de captura.
- Límite de 100 eventos por batch y 2000 eventos pendientes.
- Contadores de eventos descartados y eventos sin clientes conectados.
- Escrituras WebSocket serializadas para respetar el modelo de concurrencia de gorilla/websocket.
- Deadline de escritura WebSocket de 5 s y límite de 256 KiB para mensajes entrantes del navegador.
- Reconexión del frontend con backoff exponencial real, jitter y cancelación limpia.
- Cola frontend limitada a 5000 eventos y procesamiento máximo de 1000 por ciclo.
- Cuando la pestaña está oculta, la cola usa temporizador en lugar de depender exclusivamente de `requestAnimationFrame`.
- Corrección de una carrera al abrir WebSocket antes de inicializar la cola de eventos.
- Corrección de sincronización entre pestañas cuando una preferencia se elimina y BroadcastChannel no está disponible.

## Diagnóstico

- Estadísticas PCAP: recibidos, drops del kernel/interfaz y errores de estadísticas.
- Diagnóstico del parser: motivo más frecuente, último motivo y tamaño del último payload problemático.
- Estadísticas WebSocket: errores de lectura, fallos de escritura, cierres normales, drops de cola y eventos sin cliente.
- TUI/consola reorganizada y traducida para mostrar los nuevos contadores.
- Protección frente a resets de contadores al reconfigurar interfaces.

## Seguridad local

- El servidor HTTP escucha en `127.0.0.1` por defecto.
- `--lan` habilita explícitamente acceso desde la red local.
- Con LAN activo, las operaciones de escritura del backend siguen restringidas a localhost; otros dispositivos obtienen una vista de sólo lectura.
- WebSocket valida `Origin` para bloquear páginas web de otros orígenes.
- Cabeceras de seguridad HTTP: CSP, `nosniff`, `no-referrer`, `SAMEORIGIN` y Permissions-Policy.
- Peticiones mutables del API limitadas a 64 KiB.
- Importación de configuración limitada a 512 KiB y validada por schema.

## QA añadido

- `tools/qa-static.py`: QA offline sin descargar toolchains o dependencias.
- Comprobación de `git diff --check`.
- `gofmt` sobre archivos Go modificados.
- `node --check` sobre JavaScript first-party.
- Verificación de imports JS relativos.
- Detección de IDs HTML duplicados por plantilla.
- Verificación de referencias `/scripts/...`.
- Contrato básico entre perfiles y settings.
- Detección de cadenas visibles comunes que quedaron sin traducir.
- Tests nuevos para:
  - origen WebSocket;
  - cabeceras HTTP;
  - límite duro de cola WebSocket;
  - mutaciones del API sólo desde localhost;
  - modo compacto;
  - perfiles rápidos;
  - cola de eventos frontend;
  - backoff/reconexión WebSocket;
  - reset de contadores de dashboard.

## Fuera de alcance

Esta rama no añade mecanismos para ocultar procesos, evadir BattlEye, modificar el juego o desactivar protecciones del sistema.

## V7 — Stability & Detection

- Recursos: validación Event 39/40, living/static robusto, upserts completos y retención 120.
- Mists: layout post-Dragonfire, `originCluster`, enchant E0–E4, portales/jaulas robustos y defaults coherentes.
- Jugadores: caché independiente del límite visual, hasta 200 detectados / 100 visibles y alertas sin duplicados.
- Mapas: subzonas numéricas reutilizan el asset base; no se falsifican fondos de Mists sin asset real.
- QA offline V7 documentado en `QA-V7.md`; detalles completos en `CHANGELOG-V7.md`.
