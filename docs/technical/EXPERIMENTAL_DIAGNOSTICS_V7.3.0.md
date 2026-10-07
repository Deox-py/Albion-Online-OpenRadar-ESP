# Diagnósticos del radar e inspector

Introducidos en V7.3.0 y conservados en las fuentes radar-only V7.3.2. El nombre del archivo mantiene su referencia histórica; estas funciones pertenecen al radar y no requieren automatización.

El inspector del radar se activa manualmente y empieza desactivado cada vez que se entra en la página. Observa el WebSocket que el radar ya recibe, antes de la agrupación de movimientos. No abre otra conexión ni registra paquetes de red. Conserva hasta 500 eventos recientes en memoria; la exportación JSONL ocurre sólo al pulsar **Exportar JSONL**. Desactivar el inspector o salir del radar vacía el búfer.

Por defecto registra fecha, tipo y código de evento. La opción separada **Incluir parámetros** incorpora una copia limitada de los parámetros decodificados. Se ocultan claves identificables como contraseñas o tokens, pero los campos numéricos Photon tienen semántica desconocida y pueden contener nombres o datos de sesión; el usuario debe revisar el archivo antes de compartirlo. Desmarcar la opción elimina parámetros ya retenidos. La vista en pantalla usa texto y muestra sólo metadatos.

Los límites del inspector son 65.536 caracteres por mensaje, 100 eventos por lote, 60 mensajes y 200 eventos por segundo, 128 valores por copia, profundidad 4, 16 entradas por objeto o lista y 256 caracteres por cadena. Los eventos omitidos por estos límites y por rotación del búfer se contabilizan. Este inspector sirve para investigar; su exportación puede ser incompleta y no sustituye una captura pcap.

La sección de red muestra tramas truncadas, errores de decodificación y fragmentos IPv4 omitidos, sobre las interfaces actualmente activas. Sólo se cuentan las tramas aceptadas por el filtro de captura existente; éste puede excluir fragmentos posteriores sin cabecera UDP. Una trama truncada puede incrementar también el contador de decodificación. Los fragmentos IPv4 no se reensamblan y no se envían al parser Photon. Los fragmentos Photon conservan su tratamiento y contador propios. Una grabación pcap solicitada expresamente conserva las tramas antes del descarte diagnóstico.

# Actualizaciones reproducibles de catálogos

El actualizador usa por defecto `47e4f5aca4d30b7495afa5a625ce0d5795e32050` de `ao-data/ao-bin-dumps`, la revisión citada en el informe de investigación de 2026-10-03. Esa referencia se aplica a futuras ejecuciones del actualizador; no certifica el origen de los catálogos que ya estaban incluidos. Esta implementación no descargó ni reemplazó los datos embebidos.

La actualización es una acción explícita del desarrollador:

```powershell
npm.cmd run update-data
npm.cmd run update-data -- --ref 0123456789abcdef0123456789abcdef01234567
```

El segundo comando ilustra la sintaxis; se debe sustituir el SHA por una revisión real elegida por el desarrollador. Se admiten únicamente referencias de 40 dígitos hexadecimales; ramas y etiquetas se rechazan antes de descargar. El actualizador descarga `items.json`, `formatted/items.txt`, `mobs.json`, `spells.json`, `harvestables.json` y `cluster/world.json` desde la misma revisión. Los IDs de items siguen procediendo de `items.txt`.

Después de transformar todos los archivos se publica `web/ao-bin-dumps/source-manifest.json`, con revisión, URLs de fuentes, tamaño y SHA-256 de las seis descargas y los cinco JSON derivados. Un fallo de descarga o transformación preserva los archivos publicados. La publicación adquiere `.catalog-update.lock`, prepara los archivos en un directorio temporal, retira el manifiesto previo y publica el nuevo manifiesto al final. Los fallos normales restauran los archivos anteriores. Si falla también la recuperación, el error identifica el directorio con las copias preservadas y no publica el manifiesto previo como válido.

Las variantes `.gz` de los archivos reemplazados se retiran en la misma transacción para evitar servir datos antiguos. Se pueden regenerar posteriormente con `npm.cmd run compress:data`. Otros archivos no se reemplazan. Tras una interrupción del proceso, un desarrollador debe revisar el directorio de recuperación y los archivos publicados antes de eliminar un bloqueo residual; el actualizador no borra bloqueos de otra ejecución automáticamente.
