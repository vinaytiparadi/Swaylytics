@echo off
setlocal

echo Starting DeepAnalyze Tiramisu Frontend
echo ========================================

:: Ensure logs directory exists
if not exist logs mkdir logs

:: Define port
set TIRAMISU_PORT=3000

:: Kill existing process on port
call :KillPort %TIRAMISU_PORT%

echo.
echo Starting Tiramisu frontend...
start /B "DeepAnalyze Tiramisu" cmd /c "npm run dev -- -p %TIRAMISU_PORT% > logs\tiramisu.log 2>&1"
echo Tiramisu started in background.
echo.
echo Service URL:
echo   Tiramisu: http://localhost:%TIRAMISU_PORT%
echo.
echo Log file:
echo   Tiramisu: logs\tiramisu.log
echo.
echo Stop: run stop.bat
goto :eof

:KillPort
set port=%1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":"%port% ^| findstr "LISTENING"') do (
    echo Port %port% is in use by PID %%a. Killing...
    taskkill /F /PID %%a >nul 2>&1
)
goto :eof
