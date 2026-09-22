@echo off
rem Makes forex-signals start by itself every time you sign in to Windows
rem (minimised). Run once. To undo, run it again with the word "remove":
rem   autostart-windows.bat remove
chcp 65001 >nul
set "APPDIR=%~dp0"
set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\forex-signals.bat"
if /i "%~1"=="remove" (
  del "%LINK%" 2>nul
  echo Autostart removed.
  pause
  exit /b 0
)
where node >nul 2>nul || (echo Node.js 22.9 or newer is required: https://nodejs.org & pause & exit /b 1)
if not exist "%APPDIR%node_modules" (
  pushd "%APPDIR%" & call npm install --omit=dev & popd
)
if not exist "%APPDIR%.env" (
  echo Run start-windows.bat once first and fill in .env.
  pause
  exit /b 1
)
(
  echo @echo off
  echo cd /d "%APPDIR%"
  echo start "forex-signals" /min cmd /c "node --env-file-if-exists=.env server.js >> data\server.log 2>&1"
) > "%LINK%"
if not exist "%APPDIR%data" mkdir "%APPDIR%data"
echo Autostart installed: forex-signals will start at every sign-in.
echo Starting it now...
call "%LINK%"
timeout /t 5 >nul
start http://localhost:3000
pause
