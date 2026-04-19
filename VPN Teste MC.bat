@echo off
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

echo ==========================================
echo      VPN DE TESTE - PORTAL MC SERVICOS
echo ==========================================
echo.
echo Modo administrador detectado.
echo.

powershell -NoExit -NoProfile -ExecutionPolicy Bypass -File "%~dp0vpn-teste.ps1" -acao menu

endlocal
