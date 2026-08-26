@echo off
title Stop Techno Therm System
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p8000 = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; $p5173 = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($p8000) { Stop-Process -Id $p8000 -Force -ErrorAction SilentlyContinue; Write-Host 'Stopped Backend (Port 8000)' -ForegroundColor Green }; if ($p5173) { Stop-Process -Id $p5173 -Force -ErrorAction SilentlyContinue; Write-Host 'Stopped Frontend (Port 5173)' -ForegroundColor Green }; if (-not $p8000 -and -not $p5173) { Write-Host 'System is not running.' -ForegroundColor Yellow }"
echo.
echo Stopped.
timeout /t 2 > nul
