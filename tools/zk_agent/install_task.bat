@echo off
setlocal
cd /d "%~dp0"
set TASK=TechnoZKAgent
set MINUTES=%1
if "%MINUTES%"=="" set MINUTES=5

set PYW=
for /f "delims=" %%i in ('python -c "import os,sys;print(os.path.join(os.path.dirname(sys.executable),'pythonw.exe'))" 2^>nul') do set PYW=%%i
if not defined PYW (
    echo pythonw.exe not found. Install Python 3 and tick "Add python.exe to PATH".
    pause
    exit /b 1
)
if not exist "%PYW%" (
    echo pythonw.exe not found next to python.exe: %PYW%
    pause
    exit /b 1
)
python -c "import zk, requests" >nul 2>&1
if %errorlevel% neq 0 (
    echo Missing packages. Run first: python -m pip install -r requirements.txt
    pause
    exit /b 1
)

set CMD=\"%PYW%\" \"%~dp0zk_agent.py\"

schtasks /create /tn "%TASK%" /tr "%CMD%" /sc minute /mo %MINUTES% /f
if %errorlevel% neq 0 (
    echo Failed to create the scheduled task.
    pause
    exit /b 1
)

echo.
echo Task "%TASK%" created: runs every %MINUTES% minutes in the background.
echo Running it once now...
schtasks /run /tn "%TASK%" >nul
echo Log file: %~dp0zk_agent.log
echo To remove it later: schtasks /delete /tn "%TASK%" /f
pause
endlocal
