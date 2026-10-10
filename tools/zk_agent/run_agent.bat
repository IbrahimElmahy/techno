@echo off
setlocal
cd /d "%~dp0"
where pythonw >nul 2>&1
if %errorlevel%==0 (
    start "" /b pythonw "%~dp0zk_agent.py" %*
) else (
    python "%~dp0zk_agent.py" %*
)
endlocal
