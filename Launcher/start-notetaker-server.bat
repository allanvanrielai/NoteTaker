@echo off
rem NoteTaker local server. Serves ONLY the app folder, on this computer only (127.0.0.1), on a fixed port.
rem Usage: start-notetaker-server.bat [port]     (default 47613 - do not change it: saved containers belong to this exact address)
set PORT=%1
if "%PORT%"=="" set PORT=47613
set APPDIR=F:\OneDrive\AI\NoteTaker\app
rem Wait (up to about 5 minutes) for the F: drive / OneDrive folder to be available after sign-in.
set /a TRIES=0
:wait
if exist "%APPDIR%\index.html" goto go
set /a TRIES+=1
if %TRIES% GEQ 60 exit /b 1
timeout /t 5 /nobreak >nul
goto wait
:go
rem If something already answers on the port (for example NoteTaker is already running) there is nothing to do.
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient('127.0.0.1', %PORT%); $c.Close(); exit 0 } catch { exit 1 }"
if %ERRORLEVEL% EQU 0 exit /b 0
python "%~dp0serve.py" %PORT% "%APPDIR%"
