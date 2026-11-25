@echo off
chcp 65001 >nul
title Agendador WhatsApp Local
cd /d "%~dp0"

echo ============================================
echo   Agendador WhatsApp - Modo Local
echo ============================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERRO] Node.js nao encontrado neste computador!
  echo.
  echo Baixe e instale a versao LTS em: https://nodejs.org
  echo Depois feche esta janela e abra o iniciar.bat novamente.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/2] Instalando dependencias pela primeira vez...
  echo Isso pode levar cerca de 1 minuto. Aguarde...
  echo.
  call npm install
  if %errorlevel% neq 0 (
    echo.
    echo [ERRO] Falha ao instalar dependencias.
    pause
    exit /b 1
  )
)

echo.
echo [2/2] Iniciando servidor em http://localhost:3000 ...
echo Mantenha esta janela aberta enquanto quiser os envios automaticos ativos.
echo.

start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"
node server.js

echo.
echo Servidor encerrado.
pause
