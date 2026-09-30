@echo off
setlocal
cd /d "%~dp0"

title OpenRadar 2.3ESP_Deox - Portable Builder
echo ============================================================
echo   OpenRadar 2.3ESP_Deox - BUILD PORTABLE
echo ============================================================
echo.
echo Este asistente comprobara e instalara las herramientas
echo necesarias, ejecutara QA y generara el EXE en:
echo.
echo   dist\OpenRadar-2.3ESP_Deox.exe
echo.
echo Puede pedir confirmacion de Windows/winget durante la
echo instalacion de dependencias.
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0AUTO-BUILD-2.3ESP_Deox.ps1"
set "ERR=%ERRORLEVEL%"

echo.
if "%ERR%"=="0" (
    echo ============================================================
    echo   COMPILACION TERMINADA CORRECTAMENTE
    echo ============================================================
    echo.
    if exist "%~dp0dist\OpenRadar-2.3ESP_Deox.exe" (
        echo EXE:
        echo   %~dp0dist\OpenRadar-2.3ESP_Deox.exe
        echo.
        explorer.exe "%~dp0dist"
    )
) else (
    echo ============================================================
    echo   LA COMPILACION FALLO - codigo %ERR%
    echo ============================================================
    echo Revisa la carpeta build-logs para ver el error exacto.
)
echo.
pause
exit /b %ERR%
