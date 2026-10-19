@echo off
rem Opens NoteTaker as its own Chrome app window (no tabs, no address bar), always in the Chrome profile "APPS" (folder "Profile 5").
rem NoteTaker's saved containers and file links live in that one profile, so opening it in any other profile would show an empty NoteTaker.
rem Starts the server first if it is not running (the server script does nothing if the port already answers).
wscript "%~dp0start-notetaker-hidden.vbs"
timeout /t 2 /nobreak >nul
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --profile-directory="Profile 5" --app=http://localhost:47613/
