@echo off
setlocal
cd /d "%~dp0"

title OpenRadar 2.3ESP_Deox - Build limpio
echo ============================================================
echo   OpenRadar 2.3ESP_Deox - BUILD LIMPIO
 echo ============================================================
echo.
echo ATENCION: este modo borra node_modules y el cache compartido
echo de herramientas de OpenRadar para reconstruir todo desde cero.
echo Usalo solo si el build normal presenta problemas de dependencias.
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0AUTO-BUILD-2.3ESP_Deox.ps1" -Clean
set "ERR=%ERRORLEVEL%"

echo.
if "%ERR%"=="0" (
    echo BUILD LIMPIO TERMINADO CORRECTAMENTE
    if exist "%~dp0dist\OpenRadar-2.3ESP_Deox.exe" explorer.exe "%~dp0dist"
) else (
    echo BUILD LIMPIO FALLO - codigo %ERR%
    echo Revisa build-logs.
)
echo.
pause
exit /b %ERR%
