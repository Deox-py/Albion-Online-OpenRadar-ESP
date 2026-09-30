# OpenRadar 2.3ESP_Deox

Fork técnico/UX basado en OpenRadar `v2.2.4-beta1`, centrado en interfaz española, estabilidad, diagnóstico, rendimiento y seguridad local.

## Requisitos para compilar

- Go **1.27+**.
- Node.js **24+**.
- npm.
- Npcap SDK / toolchain requerido por la build Windows original.
- GNU Make + bash para usar el Makefile, o los comandos equivalentes manualmente.

## QA

QA estático (no necesita instalar dependencias de npm ni descargar módulos Go):

```bash
make qa-static
```

Gate completo, cuando el entorno tenga todas las dependencias:

```bash
npm ci
make qa
```

Build Windows:

```bash
make assets
make build-windows
```

El binario generado queda en `dist/OpenRadar-windows-amd64.exe`.

## Ejecución

Local, recomendado:

```powershell
.\OpenRadar-windows-amd64.exe
```

Acceso LAN explícito:

```powershell
.\OpenRadar-windows-amd64.exe --lan
```

Modo desarrollo, leyendo frontend/templates desde disco:

```powershell
.\OpenRadar-windows-amd64.exe -dev
```

La UI local queda en:

```text
http://localhost:5001
```

## Cambios destacados

- Español amplio en UI y TUI.
- Modo compacto.
- Perfiles de radar.
- Control de FPS.
- Clustering adaptativo.
- WebSocket con cola acotada y reconexión robusta.
- Diagnóstico PCAP/parser/WebSocket ampliado.
- Localhost por defecto y LAN opt-in.
- LAN de sólo lectura para controles del backend.
- Hardening HTTP/WebSocket.
- Import/export de configuración con validación.

Consulta `CHANGELOG-2.3ESP_Deox.md` para el detalle.

## Nota sobre QA de esta copia

En el entorno donde se preparó esta rama se pudo ejecutar el QA estático completo. El gate de compilación y tests dependientes de Go 1.27 / Node 24 debe ejecutarse en un entorno que tenga esas versiones y las dependencias del proyecto instaladas antes de considerar una release final firmada.
