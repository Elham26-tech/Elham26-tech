@echo off
setlocal enabledelayedexpansion
title Sarkhati
cd /d "%~dp0"

set "NODE_EXE="

rem 1) node in PATH
where node >nul 2>nul && set "NODE_EXE=node"

rem 2) common install locations, in case Node is installed but not in PATH
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%APPDATA%\npm\node.exe" set "NODE_EXE=%APPDATA%\npm\node.exe"

if not defined NODE_EXE goto :no_node

"%NODE_EXE%" server.js
echo.
echo   Sarkhati has stopped.
pause
exit /b 0

:no_node
echo.
echo   ============================================================
echo     Node.js is required but was not found on this computer.
echo   ============================================================
echo.
echo     Install it once, then run this file again:
echo.
echo       1. Open  https://nodejs.org
echo       2. Download the LTS version for Windows (.msi)
echo       3. Install it with the default options
echo       4. Close this window and double-click Sarkhati.bat again
echo.
echo     Nothing else needs to be installed.
echo.
pause
exit /b 1
