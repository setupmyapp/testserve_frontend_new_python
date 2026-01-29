@echo off
REM Simple HTTP server to run the control page (Windows)
REM This allows the extension to communicate with the control page

echo Starting local server...
echo Open http://localhost:8000/control.html in Chrome
echo Press Ctrl+C to stop the server
echo.

REM Check if Python 3 is available
python -m http.server 8000 2>nul
if errorlevel 1 (
    echo Python not found. Please install Python or use Node.js:
    echo   npx http-server -p 8000
    pause
)
