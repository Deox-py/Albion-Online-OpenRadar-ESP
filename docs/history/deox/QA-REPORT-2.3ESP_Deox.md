# QA Report — OpenRadar 2.3ESP_Deox

## Estado

**QA estático: PASS**  
**QA completo de compilación/runtime: PENDIENTE por toolchain del entorno**

Fecha de preparación: 2026-09-30.

## Checks ejecutados y aprobados

1. `git diff --check` — sin whitespace errors.
2. `gofmt` sobre archivos Go modificados.
3. `node --check` sobre JavaScript first-party.
4. Resolución de imports JS relativos.
5. Detección de IDs HTML duplicados dentro de cada plantilla.
6. Resolución de referencias absolutas `/scripts/...` usadas por plantillas.
7. Contrato entre keys usadas por perfiles y settings existentes.
8. Barrido de cadenas visibles comunes que quedaron sin traducir.
9. Verificación de archivos nuevos requeridos por 2.3ESP_Deox.
10. Verificación de branding/versionado.

Comando reproducible:

```bash
python3 tools/qa-static.py
# o
make qa-static
```

Resultado actual:

```text
QA estático 2.3ESP_Deox: 10 grupos de checks
OK: todos los checks estáticos pasaron
```

## Tests añadidos

Se añadieron tests unitarios/contratos para:

- validación same-origin de WebSocket;
- cabeceras de seguridad HTTP;
- límite duro de la cola WebSocket;
- mutaciones API restringidas a localhost;
- reset seguro de contadores del dashboard;
- modo compacto;
- perfiles rápidos;
- cola WebSocket del frontend;
- reconnect/backoff WebSocket;
- sincronización de SettingsSync mediante storage-event fallback.

## QA que debe ejecutarse antes de marcar release final

El repositorio requiere actualmente:

- Go `>=1.27`;
- Node.js `>=24`;
- dependencias npm del proyecto;
- dependencias nativas de captura/CGO correspondientes a la plataforma.

El entorno de preparación disponible tiene Go 1.23.2 y Node 22.16, por lo que no es válido para ejecutar el gate completo. Go rechaza el proyecto antes de compilar:

```text
go: go.mod requires go >= 1.27 (running go 1.23.2; GOTOOLCHAIN=local)
```

Cuando haya un entorno compatible, ejecutar:

```bash
npm ci
npm test
go test ./...
npm run lint
# y build de plataforma
```

En Windows también está incluido `BUILD-2.3ESP_Deox.ps1`, que valida versiones antes de compilar.

## Riesgos/regresiones revisados manualmente

- La captura ya no se bloquea esperando escrituras WebSocket.
- La cola backend tiene límite duro.
- La cola frontend tiene límite duro y flush en pestañas ocultas.
- Los cierres WS 1005 comunes ya no contaminan el contador como error grave.
- Los controles mutables del backend no se exponen a otros equipos al activar LAN.
- El acceso LAN es opt-in (`--lan`).
- La documentación principal fue actualizada para reflejar el nuevo comportamiento LAN.
- SettingsSync ahora propaga correctamente eliminaciones entre pestañas en fallback.
- Los toggles de backend revierten la UI cuando un POST falla.

## Limitación de este informe

Este informe no sustituye ejecutar el binario final en Windows con Npcap y una sesión de prueba. Hasta completar ese paso, los ZIP producidos deben considerarse **preview/source candidate**, no una release binaria final validada.


## V4 — correcciones tras build real de Windows

El build V3 llegó correctamente hasta Vitest: 811/819 tests pasaron.

Corregido:
- `ZonesDatabase`: tests ajustados a nombres españoles de Nieblas.
- `NetworkSettingsHandler`: tests ajustados a UI española.
- pluralización `interfazes` → `interfaces`.
- `AlertSoundUiContract`: aria-label español.
- `SettingsSync`: cachea un tombstone `null` en eliminaciones remotas para no rehidratar valores obsoletos.
- nuevo launcher portable sin CGO que puede comprobar Npcap antes de cargar el núcleo.

Pendiente de certificación final:
- volver a ejecutar `COMPILAR-PORTABLE.bat` en Windows y confirmar 819/819 + Go tests + build final.


## V5 — corrección de lint tras QA real en Windows

Resultado real de V4:
- QA estático: PASS
- Vitest: 39/39 archivos, 819/819 tests PASS
- TypeScript `tsc --noEmit`: PASS
- ESLint: 1 único fallo en `_WebSocketManager.test.js`
  - causa: `catch {}` vacío en teardown
  - corrección: comentario explícito de teardown best-effort dentro del `catch`

No se modificó lógica de producción para resolver este fallo.
