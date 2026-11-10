@echo off
title Xuper Desktop & Web - Launcher
color 0b
echo ============================================================
echo   INICIANDO XUPER DESKTOP CON DISENO SHADCN / TAILWIND
echo ============================================================
echo.

echo [1/2] Iniciando servicio backend en segundo plano (puerto 8910)...
start "Xuper Backend API" /min cmd /c "node tools/dev_service.mjs"

timeout /t 2 /nobreak >nul

echo [2/2] Iniciando servidor frontend Vite (puerto 5173)...
cd /d "%~dp0xuper-web"
start "Xuper Frontend Web" cmd /c "npm run dev -- --open"

echo.
echo Listo! La aplicacion se abrira en tu navegador predeterminado.
echo Puedes presionar cualquier tecla para cerrar este launcher.
pause
