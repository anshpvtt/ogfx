@echo off
echo 🚀 OGFX Railway Deployment
echo ==========================
echo.
echo This will deploy your backend to Railway
echo.

REM Check if PowerShell is available
powershell -Command "Get-Help" >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: PowerShell is required but not available
    pause
    exit /b 1
)

REM Run the PowerShell script
echo Starting deployment script...
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0deploy-to-railway.ps1"

pause
