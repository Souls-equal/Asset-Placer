@echo off
cd /d "%~dp0"
echo.
echo Asset Placer - local static server
echo Manifest: manifest.json
echo Put only .bloxdschem/.json/.schem files in the schematics folder.
echo Then open: http://localhost:8080
echo.
start "" http://localhost:8080
where py >nul 2>nul
if %errorlevel%==0 (
    py -3 -m http.server 8080
) else (
    python -m http.server 8080
)
pause
