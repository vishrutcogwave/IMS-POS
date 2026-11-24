@echo off
setlocal
set "installDir=%LOCALAPPDATA%\Programs\PosPrintBridge"
set "bridge=%installDir%\PosPrintBridge.exe"
set "runKey=HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
if /i "%~1"=="-Uninstall" goto uninstall

if not exist "%~dp0PosPrintBridge.exe" (
    echo Extract all files from the ZIP to a folder, then run Install.cmd from that folder.
    goto failed
)
if not exist "%installDir%\." mkdir "%installDir%"
if not exist "%installDir%\." goto failed
taskkill /IM PosPrintBridge.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul
copy /y "%~dp0PosPrintBridge.exe" "%bridge%" >nul
if errorlevel 1 (
    echo Could not replace the bridge. Close any other POS Print Bridge session and retry.
    goto failed
)
reg add "%runKey%" /v PosPrintBridge /t REG_SZ /d "\"%bridge%\" --autostart" /f >nul
if errorlevel 1 goto failed
start "" "%bridge%"
if errorlevel 1 goto failed
echo POS Print Bridge installed. Its key window is open; use Copy to pair this PC.
pause
exit /b 0

:uninstall
taskkill /IM PosPrintBridge.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul
if exist "%bridge%" (
    del "%bridge%"
    if exist "%bridge%" (
        echo Could not remove the bridge executable. Retry after closing the running bridge.
        goto failed
    )
)
reg query "%runKey%" /v PosPrintBridge >nul 2>&1
if not errorlevel 1 (
    reg delete "%runKey%" /v PosPrintBridge /f >nul
    if errorlevel 1 goto failed
)
if exist "%installDir%\." rmdir "%installDir%" 2>nul
echo POS Print Bridge removed. Its settings and logs are retained.
pause
exit /b 0

:failed
echo POS Print Bridge setup could not finish.
pause
exit /b 1
