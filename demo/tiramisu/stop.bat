@echo off
setlocal

echo Stopping DeepAnalyze Tiramisu Frontend
echo ========================================

set TIRAMISU_PORT=3000

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":"%TIRAMISU_PORT% ^| findstr "LISTENING"') do (
    echo Killing PID %%a on port %TIRAMISU_PORT%...
    taskkill /F /PID %%a >nul 2>&1
)

echo Done.
