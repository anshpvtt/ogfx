@echo off
echo 🚀 OGFX GitHub + Railway Deployment
echo =====================================
echo.
echo This will:
echo  1. Push your code to GitHub
echo  2. Deploy to Railway automatically
echo.
echo Make sure you have created a GitHub repo named "ogfx-backend"
echo.
pause

powershell -ExecutionPolicy Bypass -File "%~dp0push-and-deploy.ps1"

pause
