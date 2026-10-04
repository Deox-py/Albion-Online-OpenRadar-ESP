# V7.1 - Builder incremental + regression fix

- Cache persistente en `%LOCALAPPDATA%\OpenRadar-Deox\build-cache`.
- MSYS2/MinGW y Npcap SDK se reutilizan entre carpetas/versiones cuando siguen validos.
- `node_modules` se reutiliza si existe, esta completo y `package-lock.json` no cambio.
- npm usa cache compartida, `--prefer-offline`, `--no-audit` y `--fund=false` durante `npm ci` para reducir trafico innecesario del builder.
- `go mod download` se evita cuando `go.mod`/`go.sum` no cambiaron.
- `COMPILAR-LIMPIO.bat` fuerza una reconstruccion completa del cache solo cuando hace falta.
- El modo `-Clean` ya no intenta borrar la carpeta de build que contiene el transcript activo.
- Corregida la regresion de `DungeonsHandler`: `Parameters[3]` conserva prioridad para dungeons normales; `[16]`/`[15]` quedan como fallback para Mist/Knightfall.
- Smoke V7 ampliado con un guard contra esa regresion.

# OpenRadar 2.3ESP_Deox V7 — Stability & Detection

Fecha: 2026-09-30
Base: OpenRadar 2.3ESP_Deox V5 + sincronización selectiva con el comportamiento post-Dragonfire documentado por upstream.

## Detección de recursos

- Event 40 acepta posiciones Photon envueltas (`data`) y rechaza coordenadas inválidas.
- Event 39 valida de forma atómica sus arrays paralelos antes de crear recursos.
- La clasificación living/static ya no trata `undefined`, negativos o `65535` como recursos vivos.
- Cuando `MobsDatabase` ya está cargada, un `mobileTypeId` positivo debe corresponder realmente a un recurso vivo conocido.
- Los upserts refrescan tipo, tier, posición, enchant/charges, tamaño, `mobileTypeId` y timestamp.
- La retención espacial pasa de 80 a 120 unidades por defecto (clamp interno 80–160).
- Una posición local todavía no decodificada ya no vacía el caché de recursos durante transiciones.

> El cambio de 80 a 120 mejora la retención de entidades ya anunciadas por el servidor. No aumenta la distancia a la que el servidor transmite entidades.

## Mists / Knightfall

- `NewMob` usa el layout post-Dragonfire del portal/wisp y valida su posición.
- Enchant de Mists normalizado a E0–E4 para evitar iconos/estados inexistentes.
- Un ID de Mist repetido actualiza posición, nombre y rareza en vez de duplicarse.
- `MistsPlayerJoinedInfo` prioriza `originCluster` explícito al clasificar la nueva Mist.
- Los eventos auxiliares de Mists 521/523/532 se registran sólo para diagnóstico; no se inventan semánticas no verificadas.
- Portales de dungeon Mists priorizan el tag post-Dragonfire `[16]`, conservando fallbacks `[15]`/`[3]`.
- Portales y jaulas aceptan coordenadas Photon envueltas y descartan posiciones no finitas.
- Duplicados de portales/jaulas se actualizan sin crear entidades fantasma.
- Defaults útiles de Mists/jaulas/wisps quedan activos desde un perfil limpio; IDs de debug siguen apagados.

## Jugadores

- Ocultar la UI de jugadores ya no elimina el estado de detección recibido por red.
- `settingMaxPlayersDisplay` limita únicamente lo visible, no el caché de detección.
- Caché de jugadores aumentado a 200 entidades; visualización hasta 100, por defecto 100.
- Al llenarse el caché se elimina el registro más antiguo, en lugar de ignorar jugadores nuevos.
- IDs inválidos se rechazan.
- Un `NewCharacter` duplicado actualiza el jugador sin repetir alertas de entrada.
- Defaults de filtros pasivo/facción/peligroso se comportan como activos cuando aún no existe preferencia guardada.

> Las posiciones exactas de otros jugadores no se reconstruyen. Esta rama no añade MITM, inyección ni técnicas para saltar el cifrado de posiciones.

## Mapas y fondos

- Subzonas numéricas `NNNN-x` reutilizan el asset base `NNNN` cuando corresponde.
- Instancias con nombre conservan su ID exacto para evitar mostrar un terreno incorrecto.
- No se sustituye una Mist sin asset por el mapa de su zona de origen.

## Opciones experimentales

- Mists Solo/Duo, E0–E4, cages, wisps y Knightfall se inicializan activas sólo cuando no existe una preferencia previa.
- El overlay de IDs de wisps permanece opt-in/apagado por defecto.
- Cofres siguen marcados como experimentales; no se habilitaron heurísticas de rareza no verificadas.

## Estabilidad

- Validaciones nuevas para payloads malformados y coordenadas no finitas.
- Menos entidades duplicadas y menos vaciados prematuros de caché.
- Diagnóstico adicional para cambios futuros del protocolo.
- Se preserva la arquitectura pasiva del proyecto; no se añadieron mecanismos de ocultación o evasión del anti-cheat.
