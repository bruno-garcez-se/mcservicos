@echo off
setlocal

set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"

if not exist "%APP_DIR%.env" (
  if exist "%APP_DIR%.env.example" (
    copy /Y "%APP_DIR%.env.example" "%APP_DIR%.env" >nul
  )
)

set "NODE_BIN=%APP_DIR%runtime\node\node.exe"
if not exist "%NODE_BIN%" (
  set "NODE_BIN=node"
)

"%NODE_BIN%" "%APP_DIR%dist\server.js" >> "%APP_DIR%agent.log" 2>&1

endlocal
