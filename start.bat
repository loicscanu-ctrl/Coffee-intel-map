@echo off
echo Starting Coffee Intel Map...

:: Start backend (minimized, independent process)
PowerShell -Command "Start-Process cmd -ArgumentList '/k cd /d \"%~dp0backend\" && uvicorn main:app --host 127.0.0.1 --port 8000 --reload' -WindowStyle Minimized"

:: Wait for backend to initialize
timeout /t 4 /nobreak >nul

:: Start scraper (minimized, independent process — runs once immediately, then daily at 01:00 UTC)
PowerShell -Command "Start-Process cmd -ArgumentList '/k cd /d \"%~dp0backend\" && python -m scraper.main' -WindowStyle Minimized"

:: Start frontend (minimized, independent process)
PowerShell -Command "Start-Process cmd -ArgumentList '/k cd /d \"%~dp0frontend\" && npm run dev' -WindowStyle Minimized"

echo.
echo  Backend:  http://127.0.0.1:8000
echo  Frontend: http://localhost:3000
echo.
echo  Both services are running in the background.
echo  To stop them, close the minimized windows in your taskbar.
echo.
timeout /t 3 /nobreak >nul

:: Open browser
start http://localhost:3000
