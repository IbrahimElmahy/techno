<#
.SYNOPSIS
  بيشغّل نسخة الديف كاملة: القاعدة + الباك إند + الواجهة.

.DESCRIPTION
  **دي نسخة منفصلة تماماً عن سيرفر العميل.** بتشتغل على قاعدة محلية اسمها
  `techno_dev` على منفذ ٥٤٣٣، وعمرها ما بتفتح اتصال على السيرفر ولا على قواعد a5.

  `DATABASE_URL` بيتحط **كمتغيّر بيئة للعملية** مش في `backend\.env` — الملف ده
  بتاعك وممكن يكون مظبوط على حاجة تانية، والسكربت مالوش حق يدوس عليه. المتغيّر
  بيغلب الملف في `pydantic-settings`، وبيموت مع النافذة.

  والباك إند بيعمل الجداول لوحده أول ما يقوم (`create_all` + مزامنة الأعمدة في
  `main.py`)، فالقاعدة الفاضية بتشتغل من غير أي خطوة زيادة. الداتا الحقيقية
  بتتجاب بـ`dev_pull.ps1`.

.EXAMPLE
  .\dev.ps1            # القاعدة + الباك إند + الواجهة
  .\dev.ps1 -NoWeb     # من غير الواجهة
#>
param([switch]$NoWeb)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

& "$PSScriptRoot\dev_db.ps1" start | Out-Host

# منفذ ٥٤٣٣ واسم `techno_dev` — الاتنين مختلفين عن الإنتاج عن قصد، عشان سطر
# اتنسخ بالغلط مايوصلش لقاعدة العميل.
$env:DATABASE_URL = 'postgresql+psycopg2://techno:devpass@127.0.0.1:5433/techno_dev'
$env:JWT_SECRET = 'dev-only-not-a-secret'

Write-Host ''
Write-Host '  قاعدة الديف : techno_dev @ 127.0.0.1:5433' -ForegroundColor Cyan
Write-Host '  الباك إند   : http://127.0.0.1:8000' -ForegroundColor Cyan
if (-not $NoWeb) {
    Write-Host '  الواجهة     : http://localhost:5173' -ForegroundColor Cyan
}
Write-Host ''

$py = "$Root\backend\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) { throw "مافيش بايثون في $py" }

# الباك إند في عملية لوحده — عشان لوجه يبان لما حاجة تقع.
$api = Start-Process -PassThru -WorkingDirectory "$Root\backend" `
    -FilePath $py `
    -ArgumentList '-m', 'uvicorn', 'src.main:app', '--host', '127.0.0.1', '--port', '8000', '--reload'

$web = $null
if (-not $NoWeb) {
    $web = Start-Process -PassThru -WorkingDirectory "$Root\frontend" `
        -FilePath 'cmd.exe' -ArgumentList '/c', 'npx', 'vite', '--config', 'vite.config.web.ts'
}

Write-Host 'شغّال. اقفل النافذة دي عشان توقّف الكل.' -ForegroundColor Green
try {
    Wait-Process -Id $api.Id
}
finally {
    foreach ($p in @($api, $web)) {
        if ($p -and -not $p.HasExited) {
            Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        }
    }
    & "$PSScriptRoot\dev_db.ps1" stop | Out-Host
}
