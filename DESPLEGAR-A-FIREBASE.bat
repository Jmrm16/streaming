@echo off
title Desplegar Xuper Web a Firebase Hosting
color 0a
echo ============================================================
echo   COMPILANDO Y DESPLEGANDO A FIREBASE HOSTING
echo ============================================================
echo.
cd /d "%~dp0xuper-web"
echo [1/2] Compilando React + TypeScript + Tailwind + shadcn...
call npm run build
if %errorlevel% neq 0 (
  echo Error en la compilacion.
  pause
  exit /b %errorlevel%
)

echo.
echo [2/2] Subiendo a Firebase Hosting...
call firebase deploy --only hosting

echo.
echo ============================================================
echo   DESPLIEGUE FINALIZADO EXITOSAMENTE!
echo ============================================================
pause
