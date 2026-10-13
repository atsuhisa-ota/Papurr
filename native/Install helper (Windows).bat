@echo off
rem Double-click this file on Windows to register the Papurr helper (needed once for "External PDF app" and "Show in folder").
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (py -3 install.py) else (python install.py)
if errorlevel 1 goto failed
echo.
echo Done. Restart Chrome, then press Test in Papurr's Settings.
goto end
:failed
echo.
echo The helper was not registered (see the message above).
echo If Python 3 is not installed, install it from https://www.python.org/downloads/
echo (or run: winget install Python.Python.3.13), then double-click this file again.
:end
echo You can close this window.
pause >nul
