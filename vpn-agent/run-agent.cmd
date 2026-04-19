@echo off
setlocal

set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"

if not exist "%APP_DIR%.env" (
  if exist "%APP_DIR%.env.example" (
    copy /Y "%APP_DIR%.env.example" "%APP_DIR%.env" >nul
  )
)

node "%APP_DIR%dist\server.js" >> "%APP_DIR%agent.log" 2>&1

endlocal
