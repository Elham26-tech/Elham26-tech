@echo off
chcp 65001 >nul
title سرخطی‌زن
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js روی این سیستم پیدا نشد.
  echo   نسخهٔ LTS را از https://nodejs.org نصب کنید و دوباره این فایل را اجرا کنید.
  echo.
  pause
  exit /b 1
)

node server.js
echo.
echo   برنامه بسته شد.
pause
