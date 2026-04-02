@echo off
echo Installing Endfield Tracker...
echo.

schtasks /create /tn "EndfieldTracker" /tr "wscript.exe \"%~dp0launcher.vbs\"" /sc onlogon /rl limited /f
:: Allow running on battery power
powershell -NoProfile -Command "Set-ScheduledTask -TaskName 'EndfieldTracker' -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries)" >nul 2>&1

echo.
echo Scheduled task created. Starting tracker now...
echo.
wscript.exe "%~dp0launcher.vbs"

echo Endfield Tracker installed and running!
echo Dashboard: http://127.0.0.1:27182
echo.
pause
