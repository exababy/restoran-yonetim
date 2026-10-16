@echo off
chcp 65001 >nul
REM Yonetici olarak calistirin: guvenlik duvarina izin ekler ve Windows acilisinda otomatik baslatir
cd /d "%~dp0"
netsh advfirewall firewall add rule name="Restoran POS 3000" dir=in action=allow protocol=TCP localport=3000
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Restoran POS.lnk');$s.TargetPath='%~dp0baslat.bat';$s.WorkingDirectory='%~dp0';$s.Save()"
echo Kurulum tamamlandi. Masaustunden baslat.bat ile programi acabilirsiniz.
pause
