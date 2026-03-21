@echo off
schtasks /create /tn "EndfieldTracker" /tr "wscript.exe \"%~dp0launcher.vbs\"" /sc onlogon /rl limited /f
:: Allow running on battery power
powershell -NoProfile -Command "Set-ScheduledTask -TaskName 'EndfieldTracker' -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries)" >nul 2>&1
echo.
echo Endfield Tracker installed successfully!
echo It will start automatically when you log in.
echo.
pause
