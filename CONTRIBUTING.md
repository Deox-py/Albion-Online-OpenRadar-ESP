# Alcance de estas fuentes

La raíz del repositorio corresponde a OpenRadar 2.3ESP_Deox V7.3.2, sólo radar. Conservar la captura pasiva, los diagnósticos y la exclusión de automatización. No incorporar control de ratón/teclado, bots, captura de ventanas ni un descifrador sin evidencia y requisitos nuevos del usuario.

Los cambios de cofres deben conservar familia, tipo, modelo y estado bruto por separado. No inferir rareza de números o nombres ambiguos, ni posiciones de bytes cifrados. Mantener el símbolo neutro, los filtros de rareza desconocida y familia, y la limpieza por salida, reset o cambio real de zona.

Go 1.27 es el mínimo declarado en `go.mod`; Node.js 24+ es el mínimo de `package.json`. Las instrucciones de compilación y QA deben ejecutarse desde esta raíz, sin depender de rutas privadas o de otra copia del proyecto. Mantener la atribución MIT y los informes históricos; distinguir resultados anteriores de verificaciones nuevas.

# Entregas locales

Preferencia expresa del usuario: después de organizar una entrega local, `dist/` debe contener sólo dos EXE, sin subcarpetas ni archivos auxiliares:

- Actual: `OpenRadar-2.3ESP_Deox-V<version>.exe`.
- Anterior: `OpenRadar-2.3ESP_Deox-V<version-anterior>-Old.exe`.

Compilar y verificar primero un paquete técnico provisional, por ejemplo en `dist/.staging/V7.3.2` mediante `-OutputDirectory`, antes de sustituir una entrega existente. El builder genera archivos auxiliares para verificar el paquete; después se conservan fuera de `dist/`, bajo `.build/`, junto con ZIP, hashes y resultados temporales. La regla de dos EXE describe la entrega local terminada, no la salida técnica intermedia del builder ni una release de GitHub.

Antes de copiar o renombrar binarios, conservar la entrega previa y verificar sus hashes. Después, comprobar versión y hashes del EXE actual y del Old. Una recompilación de la misma versión no debe desplazar otra versión a Old. Si no existe un EXE anterior, no inventar un Old.

No eliminar fuentes, datos de usuario, respaldos ni versiones antiguas para simplificar la entrega. Guardar informes compartibles en `docs/` y mantener logs, capturas privadas y credenciales fuera de Git. Si Windows bloquea una carpeta porque el usuario mantiene el programa abierto, pedir que lo cierre; no finalizar sus procesos sin autorización.

No afirmar que una release o binario está publicado antes de comprobarlo. La firma es opcional y requiere credenciales reales de un certificado válido; no prometer aceptación por antivirus, SmartScreen o anti-cheat.
