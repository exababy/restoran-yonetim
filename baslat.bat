@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kurun. & pause & exit /b)
start "Restoran POS Sunucusu" /min node --no-warnings server\server.js
timeout /t 3 >nul
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" --kiosk --kiosk-printing http://localhost:3000
) else if exist "%EDGE%" (
  start "" "%EDGE%" --kiosk http://localhost:3000 --edge-kiosk-type=fullscreen --kiosk-printing
) else (
  start http://localhost:3000
)
