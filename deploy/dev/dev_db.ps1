<#
.SYNOPSIS
  بيشغّل ويوقّف قاعدة الديف المحلية.

.DESCRIPTION
  نسخة Postgres محمولة في D:\tools\pg16 — **مش مثبّتة كخدمة**. وده مقصود: الجهاز
  ده عليه شغل تاني، وخدمة بتقوم مع الويندوز على المنفذ الافتراضي بتزاحم أي حاجة
  تانية وبتفضل شغّالة وانت مش واخد بالك. دي بتقوم لما تقول لها وبتقف لما تقول لها،
  وعلى **٥٤٣٣** عشان حتى لو فيه بوستجرس تاني مايحصلش تصادم.

  المسارات كلها تحت D:\techno-dev — امسح المجلد ترجع من الأول.

.EXAMPLE
  .\dev_db.ps1 start
  .\dev_db.ps1 status
  .\dev_db.ps1 stop
#>
param([ValidateSet('start', 'stop', 'status', 'restart')][string]$Action = 'start')

$ErrorActionPreference = 'Stop'
$Bin = 'D:\tools\pg16\pgsql\bin'
$Data = 'D:\techno-dev\pgdata'
$Log = 'D:\techno-dev\pg.log'

if (-not (Test-Path "$Bin\pg_ctl.exe")) {
    throw "مافيش بوستجرس في $Bin — شوف deploy/dev/README.md"
}
if (-not (Test-Path $Data)) {
    throw "مافيش كلستر في $Data — شوف deploy/dev/README.md"
}

switch ($Action) {
    'start' { & "$Bin\pg_ctl.exe" -D $Data -l $Log start; Start-Sleep 3 }
    'stop' { & "$Bin\pg_ctl.exe" -D $Data -m fast stop }
    'restart' { & "$Bin\pg_ctl.exe" -D $Data -l $Log -m fast restart; Start-Sleep 3 }
}
& "$Bin\pg_isready.exe" -h 127.0.0.1 -p 5433
