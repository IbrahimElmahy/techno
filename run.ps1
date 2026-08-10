<#
.SYNOPSIS
    شغّل النظام — الباك إند والفرونت إند مع بعض.

.DESCRIPTION
    Two servers, one command. Each one opens in its own window so its log stays readable and
    Ctrl+C kills the right thing; this script waits until both actually ANSWER before it says
    they are up, because «started» and «serving» are not the same claim — uvicorn prints its
    banner well before the first request can be handled, and a dev server that died on a syntax
    error still printed one.

    A port already in use is not treated as a failure. It usually means the server is already
    running from an earlier session, which is the common case when you run this twice.

.EXAMPLE
    .\run.ps1
    .\run.ps1 -NoBrowser      # من غير ما يفتح المتصفح
#>
param(
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

function Test-Port([int]$Port) {
    try {
        $c = New-Object Net.Sockets.TcpClient
        $c.Connect('127.0.0.1', $Port)
        $c.Close()
        return $true
    } catch { return $false }
}

# Waits for the port to ANSWER, not for the process to exist. Returns $false on timeout rather
# than throwing, so the caller can report which half is missing.
function Wait-Port([int]$Port, [string]$Name, [int]$Seconds = 90) {
    Write-Host "  … مستني $Name على المنفذ $Port" -NoNewline
    for ($i = 0; $i -lt $Seconds; $i++) {
        if (Test-Port $Port) { Write-Host "`r  ✓ $Name شغال على المنفذ $Port          "; return $true }
        Start-Sleep -Seconds 1
        if ($i % 5 -eq 4) { Write-Host '.' -NoNewline }
    }
    Write-Host "`r  ✗ $Name ماردّش خلال $Seconds ثانية على المنفذ $Port"
    return $false
}

Write-Host ''
Write-Host '  تكنو ثيرم — تشغيل النظام' -ForegroundColor Green
Write-Host '  ─────────────────────────'

# --- الباك إند ---------------------------------------------------------------
$python = Join-Path $root 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    Write-Host "  ✗ البيئة الافتراضية مش موجودة: $python" -ForegroundColor Red
    Write-Host '    اعملها بـ: python -m venv backend\.venv ; backend\.venv\Scripts\pip install -e backend'
    exit 1
}

if (Test-Port 8000) {
    Write-Host '  ✓ الباك إند شغال من قبل كده على المنفذ 8000'
} else {
    # `--reload` so an edit to the API is live without restarting anything, and `--reload-dir`
    # so it watches the source only: pointed at the project root it also watches the sqlite file
    # the app itself writes, and every request restarts the server that just handled it.
    $backendArgs = @(
        '-m', 'uvicorn', 'src.main:app',
        '--host', '127.0.0.1', '--port', '8000',
        '--app-dir', (Join-Path $root 'backend'),
        '--reload', '--reload-dir', (Join-Path $root 'backend\src')
    )
    Start-Process -FilePath $python -ArgumentList $backendArgs `
        -WorkingDirectory (Join-Path $root 'backend') -WindowStyle Normal
}

# --- الفرونت إند --------------------------------------------------------------
if (Test-Port 5173) {
    Write-Host '  ✓ الفرونت إند شغال من قبل كده على المنفذ 5173'
} else {
    if (-not (Test-Path (Join-Path $root 'frontend\node_modules'))) {
        Write-Host '  … أول تشغيل: بتثبيت الحزم (npm install)' -ForegroundColor Yellow
        Push-Location (Join-Path $root 'frontend')
        npm install
        Pop-Location
    }
    # Through cmd.exe because `npm` on Windows is a .cmd shim, and Start-Process cannot launch one
    # directly. `/k` keeps the window open when it exits, so a crash leaves its reason on screen
    # instead of closing over it.
    Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/k', 'npm', 'run', 'dev', '--', '--port', '5173', '--host', '127.0.0.1' `
        -WorkingDirectory (Join-Path $root 'frontend') -WindowStyle Normal
}

Write-Host ''
$backendUp  = Wait-Port 8000 'الباك إند'
$frontendUp = Wait-Port 5173 'الفرونت إند'

Write-Host ''
if ($backendUp -and $frontendUp) {
    Write-Host '  النظام شغال:' -ForegroundColor Green
    Write-Host '    الواجهة   →  http://localhost:5173'
    Write-Host '    الـ API   →  http://localhost:8000/docs'
    if (-not $NoBrowser) { Start-Process 'http://localhost:5173' }
} else {
    # Name the half that is missing. «فشل التشغيل» sends somebody to read both windows.
    Write-Host '  فيه حاجة ماشتغلتش — بصّ في النافذة بتاعتها:' -ForegroundColor Red
    if (-not $backendUp)  { Write-Host '    ✗ الباك إند  (نافذة python)' }
    if (-not $frontendUp) { Write-Host '    ✗ الفرونت إند (نافذة npm)' }
    exit 1
}
Write-Host ''
