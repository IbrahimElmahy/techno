# السحب اليومي لفرع المصنع — بيتشغّل **على سيرفر المصنع**، وبيرفع لسيرفرنا.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\techno\a5_sync_factory.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\techno\a5_sync_factory.ps1 -ExportOnly
#
# ⚠️ **قاعدة a5 قراءة بس.** كل استعلام هنا `SELECT` — مافيش `INSERT` ولا `UPDATE` ولا
# حتى جدول مؤقت. الشركة شغّالة على القاعدة دي دلوقتي ومافيش نسخة نرجّع منها.
#
# ---------------------------------------------------------------------------
# **ليه رفع مش سحب.** العلياء وأكتوبر قاعدتهم على نفس سيرفر الباك إند، فسحبهم
# `a5_sync.ps1` محلياً. المصنع سيرفر تاني: ويندوز ٢٠١٢ R2، مافيهوش `ssh` ولا `scp` ولا
# `curl`، وSSH بتاعه ورا نفق كلاودفلير فسيرفرنا مايوصلوش. والاتجاه التاني مفتوح —
# قِسناه: المصنع بيوصل لـ`app.technothermeg.com` على ٤٤٣.
#
# فالمصنع بيصدّر ويرفع، والسيرفر بيستورد. **مافيش مفتاح SSH هنا ولا منفذ بيتفتح.**
#
# **والنتيجة اللي خلّت ده لازم:** التصدير كان بالإيد، وآخر استيراد بقى أقدم من آخر
# تصدير — ٢٦ إذن تحويل و٤ فواتير بيع فضلوا بره النظام، والمخزن عندنا قال بضاعة في مكان
# وهي اتنقلت من أسبوع.
#
# ---------------------------------------------------------------------------
# **TLS 1.2 بالإيد.** الويندوز ده افتراضيه `Ssl3, Tls`، والسيرفر بيرفضهم — والرسالة
# اللي بتطلع («Could not create SSL/TLS secure channel») مابتقولش السبب. السطر ده هو
# الفرق بين سحب شغّال وسحب بيفشل كل ليلة من غير ما حد يعرف ليه.
#
# **والتصدير كامل مش الجديد بس، عن قصد.** المستوردين بيتخطوا الموجود (المستند برقمه)،
# فالتصدير الكامل بيلقّط كمان **التعديل الرجعي**: فاتورة اتظبطت بتاريخ قديم، أو سطر
# اتصلّح. الفلترة بالتاريخ كانت هتفوّتهم وماحدش هيعرف.
param(
    [switch]$ExportOnly,
    [string]$ApiBase  = 'https://app.technothermeg.com',
    [string]$Branch   = 'factory',
    [string]$Db       = 'factory Pro2026'
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root   = 'C:\techno'
$SqlDir = Join-Path $Root 'a5_sql'
$OutDir = 'C:\pgtmp\factory'
$LogDir = 'C:\pgtmp\sync'
foreach ($d in @($OutDir, $LogDir)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force $d | Out-Null }
}
$Log = Join-Path $LogDir ('factory_{0:yyyy-MM-dd}.log' -f (Get-Date))

function Say($m) {
    $line = '{0:HH:mm:ss}  {1}' -f (Get-Date), $m
    Write-Host $line
    Add-Content -Path $Log -Value $line -Encoding UTF8
}

# الملف اللي بيتصدّر → الاسم اللي السيرفر بيقبله. الترتيب مقصود: السطور والرؤوس
# آخر حاجة، عشان لو التصدير اتقطع في النص مايبقاش عندنا رؤوس من غير سطورها.
$Exports = @(
    @{ Sql = 'exp_items.sql';        Out = 'a5_items.tsv'     },
    @{ Sql = 'exp_cats.sql';         Out = 'a5_cats.tsv'      },
    @{ Sql = 'exp_misc.sql';         Out = 'a5_misc.tsv'      },
    @{ Sql = 'exp_cust.sql';         Out = 'a5_cust.tsv'      },
    @{ Sql = 'exp_bal_by_store.sql'; Out = 'a5_bal_store.tsv' },
    @{ Sql = 'exp_hdr.sql';          Out = 'a5_hdr.tsv'       },
    @{ Sql = 'exp_lines.sql';        Out = 'a5_lines.tsv'     }
)

$Sqlcmd = (Get-ChildItem 'C:\Program Files\Microsoft SQL Server',
                         'C:\Program Files (x86)\Microsoft SQL Server' `
           -Recurse -Filter sqlcmd.exe -ErrorAction SilentlyContinue |
           Select-Object -First 1).FullName
if (-not $Sqlcmd) { throw 'مالقيتش sqlcmd.exe على السيرفر ده.' }

Say "=== بدأ · القاعدة: $Db ==="

foreach ($e in $Exports) {
    $sqlPath = Join-Path $SqlDir $e.Sql
    if (-not (Test-Path $sqlPath)) { Say "  ⚠ مافيش $($e.Sql) — اتخطّى"; continue }
    $outPath = Join-Path $OutDir $e.Out
    # **ملف الاستعلام بيتحوّل UTF-16LE قبل ما يتشغّل.** ملف SQL فيه عربي مكتوب UTF-8
    # بيتقرا غلط في sqlcmd والنتيجة **صفر صفوف من غير أي رسالة خطأ** — وده أوحش من
    # الفشل، لأنه بيعدّي على إنه نجاح.
    $tmpSql = Join-Path $env:TEMP ("a5_{0}" -f $e.Sql)
    Set-Content -Path $tmpSql -Value (Get-Content $sqlPath -Encoding UTF8 -Raw) -Encoding Unicode
    & $Sqlcmd -S . -E -d $Db -i $tmpSql -o $outPath -s '~' -W -h -1 -u
    if ($LASTEXITCODE -ne 0) { throw "التصدير فشل عند $($e.Sql)" }
    $kb = [int]((Get-Item $outPath).Length / 1KB)
    Say ("  {0,-20} {1,7} ك.ب" -f $e.Out, $kb)
}

if ($ExportOnly) { Say '=== تصدير بس — مافيش رفع ==='; exit 0 }

# --- الدخول ---------------------------------------------------------------
#
# بيانات الدخول من ملف جنب السكربت — **مش مكتوبة في الكود.** الملف بره git،
# وصلاحياته على المستخدم اللي بيشغّل المهمة وحده.
#
# **وبتتقرا هنا مش فوق:** `-ExportOnly` بيصدّر من غير ما يرفع — بيتستعمل للفحص ولإعادة
# البناء — فطلب كلمة السر قبل التصدير كان بيوقف حاجة مالهاش لازمة بيها.
$CredFile = Join-Path $Root 'a5_sync.cred'
if (-not (Test-Path $CredFile)) { throw "مافيش $CredFile — فيه سطرين: المستخدم وكلمة السر." }
$cred = Get-Content $CredFile -Encoding UTF8 | Where-Object { $_.Trim() -ne '' }
if ($cred.Count -lt 2) { throw "$CredFile لازم يكون سطرين: المستخدم وكلمة السر." }
$User = $cred[0].Trim(); $Pass = $cred[1].Trim()
$body = @{ username = $User; password = $Pass } | ConvertTo-Json -Compress
$auth = Invoke-RestMethod -Uri "$ApiBase/api/v1/auth/login" -Method Post `
        -ContentType 'application/json' -Body $body -TimeoutSec 60
$Headers = @{ Authorization = "Bearer $($auth.access_token)" }
Say '  دخول ✓'

# --- الرفع ----------------------------------------------------------------
#
# `Invoke-RestMethod` في PowerShell 4 مافيهوش `-Form`، فالـmultipart بيتبني بالإيد.
# والملف بيتقرا كبايتات خام (`Byte[]`) وبيتحوّل بـLatin1: أي ترميز تاني بيفسد
# UTF-16 بتاع التصدير، والسيرفر بيستلم ملف متبهدل من غير ما يشتكي.
Add-Type -AssemblyName System.Web
foreach ($e in $Exports) {
    $path = Join-Path $OutDir $e.Out
    if (-not (Test-Path $path)) { continue }
    $boundary = [Guid]::NewGuid().ToString()
    $LF = "`r`n"
    $bytes = [IO.File]::ReadAllBytes($path)
    $enc = [Text.Encoding]::GetEncoding('iso-8859-1')
    $head = "--$boundary$LF" +
            "Content-Disposition: form-data; name=`"filename`"$LF$LF$($e.Out)$LF" +
            "--$boundary$LF" +
            "Content-Disposition: form-data; name=`"file`"; filename=`"$($e.Out)`"$LF" +
            "Content-Type: application/octet-stream$LF$LF"
    $tail = "$LF--$boundary--$LF"
    $payload = $enc.GetBytes($head) + $bytes + $enc.GetBytes($tail)
    $r = Invoke-RestMethod -Uri "$ApiBase/api/v1/a5-sync/$Branch/upload" -Method Post `
         -Headers $Headers -ContentType "multipart/form-data; boundary=$boundary" `
         -Body $payload -TimeoutSec 300
    Say ("  رفع {0,-20} {1,9} بايت" -f $r.file, $r.bytes)
}

# --- الاستيراد ------------------------------------------------------------
#
# في نفس التشغيلة عن قصد: فصل الرفع عن الاستيراد معناه إن حد لازم يفتكر يشغّل التاني،
# وده بالظبط اللي فشل قبل كده — الملفات كانت بتتصدّر والاستيراد يفضل أقدم منها.
$res = Invoke-RestMethod -Uri "$ApiBase/api/v1/a5-sync/$Branch/import" -Method Post `
       -Headers $Headers -TimeoutSec 1800
Say ("=== خلص · أذون التحويل: {0} ← {1} ===" -f $res.transfers_before, $res.transfers_after)
