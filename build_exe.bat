@echo off
setlocal
cd /d "%~dp0"
title NAPS EXE Builder
cls
echo ========================================================
echo   NAPS - Build Windows installer and portable EXE
echo ========================================================
echo.
echo Step 1/3: Checking project dependencies...
where npm >nul 2>nul
if errorlevel 1 goto missing_node
call npm ci
if errorlevel 1 goto failed
echo.
echo Step 2/3: Building web assets (Vite)...
call npm run dist:win
if errorlevel 1 goto failed
echo.
echo Step 3/3: Done.
echo.
echo ========================================================
echo   BUILD COMPLETED!
echo   Installer: release\NAPS-Setup-1.0.0-x64.exe
echo   Portable:  release\NAPS-Portable-1.0.0-x64.exe
echo ========================================================
pause
exit /b 0

:missing_node
echo Node.js is required. Install Node.js LTS from https://nodejs.org/
pause
exit /b 1

:failed
echo BUILD FAILED. See the error above. No successful build is being reported.
pause
exit /b 1
