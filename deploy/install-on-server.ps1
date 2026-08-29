# تركيب نظام تكنو على سيرفر ويندوز محلي — من الصفر لخدمة شغّالة.
#
# بيتشغّل على السيرفر نفسه، من PowerShell كمسؤول:
#
#     powershell -ExecutionPolicy Bypass -File install-on-server.ps1
#
# بيتعاد تشغيله بأمان: الموجود بيتساب، والناقص بس هو اللي بيتركّب.
#
# ---------------------------------------------------------------------------
# ليه سكربت مش خطوات مكتوبة:
#
# التركيب ده هيتعاد — على سيرفر تاني، أو على نفس السيرفر بعد فرمتة، أو بعد سنة لما
# يبقى محدش فاكر. الخطوات المكتوبة في ورقة بتنقص خطوة كل مرة، والسكربت بيفتكر.
#
# ولأن السيرفر ده بيشغّل نظام a5 على SQL Server، السكربت **مابيلمسش** أي حاجة قايمة:
# قاعدة بيانات منفصلة، منفذ منفصل، خدمة باسمها. لو وقع في نص الطريق، اللي كان شغّال
# بيفضل شغّال.
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'

$Root        = 'C:\techno'
$RepoUrl     = 'https://github.com/IbrahimElmahy/techno.git'
$ApiPort     = 8000
$PyVersion   = '3.12.8'   # آخر إصدار بيشتغل على ويندوز سيرفر 2012 R2 — 3.13 عايز ويندوز 10
$ServiceName = 'TechnoApi'

function Say([string]$m, [string]$c = 'Cyan') { Write-Host "  $m" -ForegroundColor $c }
function Step([string]$m) { Write-Host "`n=== $m" -ForegroundColor Yellow }

# TLS 1.2 — 2012 R2 بيبتدي على 1.0، وGitHub وpython.org بيرفضوه.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Step 'فحص المتطلبات'
$is64 = [Environment]::Is64BitOperatingSystem
Say "ويندوز: $((Get-CimInstance Win32_OperatingSystem).Caption) ($(if($is64){'64'}else{'32'}) بت)"

# --- 1) بايثون -------------------------------------------------------------
Step 'بايثون'
$py = Get-Command python -ErrorAction SilentlyContinue
if ($py -and (& python -c "import sys; print(sys.version_info>=(3,11))") -eq 'True') {
    Say "موجود: $(& python --version)" 'Green'
} else {
    Say "بتحميل بايثون $PyVersion ..."
    $exe = "$env:TEMP\python-$PyVersion.exe"
    Invoke-WebRequest "https://www.python.org/ftp/python/$PyVersion/python-$PyVersion-amd64.exe" -OutFile $exe
    # PrependPath عشان الخدمة تلاقيه من غير مسار كامل
    Start-Process $exe -ArgumentList '/quiet InstallAllUsers=1 PrependPath=1 Include_pip=1' -Wait
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    Say "اتركّب: $(& python --version)" 'Green'
}

# --- 2) الكود --------------------------------------------------------------
Step 'الكود'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Say 'بتحميل Git ...'
    $g = "$env:TEMP\git-setup.exe"
    Invoke-WebRequest 'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-64-bit.exe' -OutFile $g
    Start-Process $g -ArgumentList '/VERYSILENT /NORESTART' -Wait
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine')
}
if (Test-Path "$Root\.git") {
    Say 'موجود — بيتحدّث'
    Push-Location $Root; & git fetch --all; & git reset --hard origin/main; Pop-Location
} else {
    Say "بيتنزّل في $Root ..."
    & git clone $RepoUrl $Root
}

# --- 3) البيئة والمكتبات ---------------------------------------------------
Step 'مكتبات بايثون'
Push-Location "$Root\backend"
if (-not (Test-Path '.venv')) { & python -m venv .venv }
& .\.venv\Scripts\python.exe -m pip install --upgrade pip --quiet
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt --quiet
Say 'تمام' 'Green'
Pop-Location

# --- 4) قاعدة البيانات -----------------------------------------------------
Step 'قاعدة البيانات'
$envFile = "$Root\backend\.env"
if (Test-Path $envFile) {
    Say '.env موجود — مش هيتلمس' 'Green'
} else {
    Say 'مافيش .env — لازم تكتبه بنفسك قبل التشغيل:' 'Yellow'
    Say "  $envFile" 'Yellow'
    Say '  DATABASE_URL=postgresql://user:pass@localhost:5432/techno' 'Yellow'
    Say '  JWT_SECRET=<نص عشوائي طويل>' 'Yellow'
    Say ''
    Say 'الباسوردات مابتتكتبش في سكربت — دي بتتحط بالإيد مرة واحدة.' 'Yellow'
}

# --- 5) الواجهة ------------------------------------------------------------
# البناء بيتعمل على جهاز المطوّر مش هنا: Node 18+ مابيشتغلش على 2012 R2، والسيرفر
# مش محتاج يبني — محتاج يقدّم ملفات جاهزة.
Step 'الواجهة'
if (Test-Path "$Root\frontend\dist\index.html") {
    Say 'ملفات الواجهة موجودة' 'Green'
} else {
    Say 'ناقصة — ابنيها على جهازك وانسخ frontend\dist هنا:' 'Yellow'
    Say '  npm --prefix frontend run build' 'Yellow'
}

# --- 6) الخدمة ------------------------------------------------------------
Step 'خدمة ويندوز'
$nssm = "$Root\deploy\nssm.exe"
if (-not (Test-Path $nssm)) {
    Say 'بتحميل NSSM (بيشغّل البرنامج كخدمة تقوم مع السيرفر) ...'
    $zip = "$env:TEMP\nssm.zip"
    Invoke-WebRequest 'https://nssm.cc/release/nssm-2.24.zip' -OutFile $zip
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $tmp = "$env:TEMP\nssm-x"
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $tmp)
    Copy-Item "$tmp\nssm-2.24\win64\nssm.exe" $nssm -Force
}

$existing = Get-Service $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Say 'الخدمة موجودة — بتتوقف للتحديث'
    & $nssm stop $ServiceName 2>$null | Out-Null
} else {
    & $nssm install $ServiceName "$Root\backend\.venv\Scripts\python.exe" | Out-Null
}
& $nssm set $ServiceName AppDirectory   "$Root\backend"              | Out-Null
& $nssm set $ServiceName AppParameters  "-m uvicorn src.main:app --host 127.0.0.1 --port $ApiPort" | Out-Null
& $nssm set $ServiceName Start          SERVICE_AUTO_START           | Out-Null
& $nssm set $ServiceName AppStdout      "$Root\logs\api.log"         | Out-Null
& $nssm set $ServiceName AppStderr      "$Root\logs\api.err.log"     | Out-Null
& $nssm set $ServiceName AppRotateFiles 1                            | Out-Null
New-Item -ItemType Directory -Force "$Root\logs" | Out-Null

# 127.0.0.1 مش 0.0.0.0 عن قصد: النفق هو الباب الوحيد. الخدمة مربوطة على اللوكال
# بس، فحتى لو حد وصل للشبكة الداخلية مايوصلش للـAPI مباشرة.
Say "الخدمة مربوطة على 127.0.0.1:$ApiPort — النفق بس هو اللي بيوصلها" 'Green'

if (Test-Path $envFile) {
    & $nssm start $ServiceName | Out-Null
    Start-Sleep 6
    try {
        $h = Invoke-RestMethod "http://127.0.0.1:$ApiPort/health" -TimeoutSec 15
        Say "شغّالة — commit $($h.commit) · $($h.routes) مسار" 'Green'
    } catch {
        Say "مااشتغلتش — شوف $Root\logs\api.err.log" 'Red'
    }
} else {
    Say 'مش هتتشغّل قبل ما .env يتكتب' 'Yellow'
}

Step 'تم'
Write-Host @"
  الباقي عليك:
    1) اكتب $envFile   (DATABASE_URL و JWT_SECRET)
    2) انسخ frontend\dist من جهازك لـ $Root\frontend\dist
    3) في Cloudflare Zero Trust > Tunnels > my-server > Public Hostname:
         api.technothermeg.com  ->  HTTP  ->  localhost:$ApiPort
         app.technothermeg.com  ->  HTTP  ->  localhost:$ApiPort
    4) Start-Service $ServiceName
"@ -ForegroundColor Cyan
