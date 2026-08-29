# نسخة احتياطية من قاعدة النظام — بتتشغّل كل يوم من مهمة مجدولة.
#
#   powershell -ExecutionPolicy Bypass -File backup.ps1
#
# ---------------------------------------------------------------------------
# أربع قرارات، كل واحد لأن البديل بيفشل في لحظة معينة:
#
# **١. النسخة على قرص تاني.** الاستضافة السحابية كانت بتاخد نسخة على جهاز تاني خالص.
#    محلياً أقرب حاجة لده قرص مختلف: القرص بيقع كوحدة واحدة، فنسخة جنب الأصل على نفس
#    القرص بتروح معاه. `D:` مش `C:`.
#
# **٢. `pg_dump` مش نسخ ملفات.** ملفات القاعدة وهي شغالة نسخة نصّها مكتوب — بتفتح
#    أحياناً وبتبوظ أحياناً، ومحدش بيعرف غير وقت الاستعادة. `pg_dump` بيقرا لقطة متسقة
#    والقاعدة شغالة.
#
# **٣. النسخة بتتفحص بعد ما تتاخد.** ملف صفر بايت بيتكتب بنجاح وبيفضل في المجلد شهور
#    وكله مبسوط. الفحص هنا: الحجم معقول، والملف بيتقرا لآخره.
#
# **٤. الاحتفاظ ٣٠ يوم.** العطل مش دايماً بيتكشف في نفس اليوم — رقم اتكسر امبارح ممكن
#    يتلاحظ الأسبوع الجاي. نسخة واحدة معناها إنك بتستعيد الغلط نفسه.
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'

$BackupDir = 'D:\techno-backups'
$PgBin     = 'C:\PostgreSQL\16\bin'
$EnvFile   = 'C:\techno\backend\.env'
$KeepDays  = 30

New-Item -ItemType Directory -Force $BackupDir | Out-Null
$log = Join-Path $BackupDir 'backup.log'
function Say([string]$m) {
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
    Write-Host $line
    Add-Content -Path $log -Value $line -Encoding utf8
}

try {
    # بيانات الاتصال بتتقرا من ملف البيئة — الباسورد مايتكتبش في سكربت ولا في مهمة مجدولة.
    $url = (Get-Content $EnvFile | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=', ''
    if (-not $url) { throw "مافيش DATABASE_URL في $EnvFile" }
    if ($url -notmatch '://([^:]+):([^@]+)@([^:/]+):(\d+)/(.+?)(\?|$)') { throw "شكل DATABASE_URL مش مفهوم" }
    $user, $pass, $hostname, $port, $dbname = $Matches[1], $Matches[2], $Matches[3], $Matches[4], $Matches[5]

    $stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
    $out   = Join-Path $BackupDir "techno_$stamp.dump"

    Say "بيبدأ — $dbname"
    $env:PGPASSWORD = $pass
    # -Fc: صيغة مضغوطة، وبتسمح باستعادة جدول واحد من غير النسخة كلها.
    & "$PgBin\pg_dump.exe" -h $hostname -p $port -U $user -d $dbname -Fc -f $out
    if ($LASTEXITCODE -ne 0) { throw "pg_dump رجع $LASTEXITCODE" }
    $env:PGPASSWORD = $null

    $mb = [math]::Round((Get-Item $out).Length / 1MB, 2)
    if ($mb -lt 0.05) { throw "النسخة صغيرة أوي ($mb MB) — يبقى فيه حاجة غلط" }

    # الفحص: الملف بيتقرا لآخره فعلاً. `pg_restore -l` بيفك الفهرس، ولو الملف مقطوع بيفشل.
    $listed = & "$PgBin\pg_restore.exe" -l $out 2>&1
    if ($LASTEXITCODE -ne 0) { throw "النسخة اتكتبت بس مابتتقراش — pg_restore رفضها" }
    $objects = ($listed | Where-Object { $_ -notmatch '^;' }).Count
    Say "تمام — $mb ميجا · $objects كائن · $out"

    # التنضيف: القديم بيتشال بعد ما الجديدة تنجح، مش قبلها. لو النسخة النهاردة فشلت،
    # اللي فات بيفضل موجود.
    $old = Get-ChildItem $BackupDir -Filter 'techno_*.dump' |
           Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) }
    foreach ($f in $old) {
        Remove-Item $f.FullName -Force
        Say "اتشالت نسخة قديمة: $($f.Name)"
    }

    $all = Get-ChildItem $BackupDir -Filter 'techno_*.dump'
    Say ("عدد النسخ: {0} · إجمالي {1} ميجا" -f $all.Count,
         [math]::Round(($all | Measure-Object Length -Sum).Sum / 1MB, 1))
}
catch {
    Say "فشلت: $($_.Exception.Message)"
    exit 1
}
