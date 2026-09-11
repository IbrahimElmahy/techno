<#
.SYNOPSIS
  بيجيب نسخة من داتا السيرفر ويحطها في قاعدة الديف.

.DESCRIPTION
  **اتجاه واحد: من السيرفر للديف.** مافيش سطر هنا بيكتب على السيرفر، والسكربت
  بيرفض يشتغل على أي قاعدة غير `techno_dev` — عشان سطر اتنسخ بالغلط مايمسحش
  قاعدة العميل.

  بياخد `pg_dump` جديد من السيرفر عبر SSH، ينزّله، ويعمل `pg_restore --clean` على
  المحلية. اللي كان في الديف بيتشال — دي نسخة مش دمج.

  الباسوردات بتتقرا من `backend\.env` **على السيرفر** ومابتعدّيش من هنا.

.EXAMPLE
  .\dev_pull.ps1
  .\dev_pull.ps1 -From D:\techno-backups\something.dump   # من ملف عندك بدل السيرفر
#>
param(
    [string]$From,
    [string]$SshHost = 'ssh.technothermeg.com'
)

$ErrorActionPreference = 'Stop'
$Bin = 'D:\tools\pg16\pgsql\bin'
$DevDb = 'techno_dev'

if ($DevDb -ne 'techno_dev') { throw 'الكتابة مسموحة على techno_dev بس.' }

$dump = $From
if (-not $dump) {
    $stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
    $remote = "C:/pgtmp/devpull_$stamp.dump"
    $dump = "D:\techno-dev\devpull_$stamp.dump"

    Write-Host 'باخد نسخة من السيرفر...' -ForegroundColor Cyan
    # الأمر بيتبعت base64 بترميز UTF-16LE — جلسة الـSSH بتقع في cmd.exe، وأي
    # اقتباس أو أنبوب في النص بيتفسّر مرتين في الطريق.
    $ps = @"
`$u = (Select-String -Path C:\techno\backend\.env -Pattern '^DATABASE_URL').Line
if (`$u -match '://([^:]+):([^@]+)@([^:/]+):?(\d*)/(\w+)') {
  `$env:PGPASSWORD = `$Matches[2]
  `$p = if (`$Matches[4]) { `$Matches[4] } else { '5432' }
  & 'C:\PostgreSQL\16\bin\pg_dump.exe' -h `$Matches[3] -p `$p -U `$Matches[1] -d `$Matches[5] -Fc -f '$remote'
  if (`$LASTEXITCODE -eq 0) { 'DUMP-OK' } else { 'DUMP-FAILED' }
} else { 'ENV-UNREADABLE' }
"@
    $b64 = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($ps))
    $out = ssh -o BatchMode=yes -o ConnectTimeout=30 $SshHost "powershell -NoProfile -EncodedCommand $b64"
    if ($out -notmatch 'DUMP-OK') { throw "النسخة على السيرفر فشلت: $out" }

    Write-Host 'بنزّلها...' -ForegroundColor Cyan
    scp -o BatchMode=yes "${SshHost}:$remote" $dump
    ssh -o BatchMode=yes $SshHost "powershell -NoProfile -Command Remove-Item '$remote' -Force" | Out-Null
}

if (-not (Test-Path $dump)) { throw "مافيش ملف $dump" }
'{0:N1} ميجا' -f ((Get-Item $dump).Length / 1MB)

& "$PSScriptRoot\dev_db.ps1" start | Out-Host
$env:PGPASSWORD = 'devpass'

Write-Host 'برجّعها في قاعدة الديف...' -ForegroundColor Cyan
# `--clean --if-exists` بيشيل اللي كان في الديف قبل ما يحط الجديد. وملكية
# الجداول والصلاحيات مالهاش لازمة على جهاز واحد، فبتتسكت بـ`--no-owner --no-acl`.
& "$Bin\pg_restore.exe" -h 127.0.0.1 -p 5433 -U techno -d $DevDb `
    --clean --if-exists --no-owner --no-acl $dump
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠ pg_restore رجع كود $LASTEXITCODE — راجع اللي فوق" -ForegroundColor Yellow
}

$counts = & "$Bin\psql.exe" -h 127.0.0.1 -p 5433 -U techno -d $DevDb -tA -c @"
SELECT 'عملاء=' || (SELECT count(*) FROM customer)
    || '  أصناف=' || (SELECT count(*) FROM item)
    || '  فواتير=' || (SELECT count(*) FROM sales_invoice)
    || '  معاينات=' || (SELECT count(*) FROM inspection)
"@
Write-Host ''
Write-Host "تمام — $counts" -ForegroundColor Green
