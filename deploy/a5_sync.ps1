# تزامن يومي مع a5 — بيجيب اللي اتعمل عندهم من إمبارح ويحطّه عندنا.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\techno\deploy\a5_sync.ps1
#
# ⚠️ **قواعد a5 قراءة بس.** السكربت ده `SELECT` وخلاص — مافيش `INSERT` ولا `UPDATE`
# ولا حتى جدول مؤقت. الشركة شغّالة عليهم دلوقتي ومافيش نسخة نرجّع منها.
#
# ---------------------------------------------------------------------------
# **ليه أصلاً:** النقل الأصلي لقطة. قِسنا الفرق: آخر حركة عندنا ٢٩ أغسطس، وa5 كمّل
# ٣٠ و٣١ و١ و٢ و٣ سبتمبر — ١٬١٠٨ سطر دفتر و١٧٦ فاتورة. والفرق بيكبر كل يوم طول ما
# الشركة شغّالة على النظامين.
#
# **بيصدّر الكل مش الجديد بس، عن قصد.** المستوردين بيتخطوا اللي موجود (المستند
# برقمه، والقيد بـ`external_ref`)، فإعادة التصدير الكاملة بتلقّط كمان **التعديل
# الرجعي**: فاتورة اتظبطت بتاريخ قديم، أو سطر اتصلّح. الفلترة بالتاريخ كانت هتفوّتهم
# ومحدش هيعرف. والتكلفة دقايق، والدقة تستاهل.
#
# **الفاصل `~` مش tab** — ده اللي `import_a5._read` بيقراه، وهو نفس شكل التصدير
# الأصلي. أي فاصل تاني بيدّي صفوف بعمود واحد من غير ما حد ياخد باله.
$ErrorActionPreference = 'Stop'

$Root    = 'C:\techno'
$Py      = "$Root\backend\.venv\Scripts\python.exe"
$SqlDir  = "$Root\deploy\a5_sql"
$LogDir  = 'C:\pgtmp\sync'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force $LogDir | Out-Null }
$Log = Join-Path $LogDir ('sync_{0:yyyy-MM-dd}.log' -f (Get-Date))

function Say($m) {
    $line = '{0:HH:mm:ss}  {1}' -f (Get-Date), $m
    Write-Host $line
    Add-Content -Path $Log -Value $line -Encoding UTF8
}

# فرع → (قاعدة a5، مجلد التصدير، اسم الفرع عندنا، بادئة الأكواد)
$Branches = @(
    @{ Db = 'aliaa2026';  Dir = 'C:\pgtmp\aliaa'; Name = 'العلياء'; Prefix = 'AL-' },
    @{ Db = 'Techno2026'; Dir = 'C:\pgtmp';       Name = 'أكتوبر';  Prefix = ''    }
)

# ملف الاستعلام → الملف اللي المستوردين بيقروه
$Exports = @(
    @{ Sql = 'exp_hdr.sql';   Out = 'a5_hdr.tsv'      },
    @{ Sql = 'exp_lines.sql'; Out = 'a5_lines.tsv'    },
    @{ Sql = 'exp_acc.sql';   Out = 'a5_acclines.tsv' }
)

function Export-A5 ($db, $sqlPath, $outPath) {
    $sql = Get-Content $sqlPath -Raw -Encoding UTF8
    $c = New-Object System.Data.SqlClient.SqlConnection(
        "Server=localhost;Database=$db;Integrated Security=True;" +
        "Connect Timeout=30;TrustServerCertificate=True")
    $c.Open()
    try {
        $cmd = $c.CreateCommand()
        $cmd.CommandText = $sql
        $cmd.CommandTimeout = 900
        $r = $cmd.ExecuteReader()
        # الكتابة على ملف مؤقت والاستبدال في الآخر: لو التصدير وقع في نصّه، الملف
        # القديم يفضل سليم بدل ما نستورد نص كشف ونفتكره كامل.
        $tmp = "$outPath.tmp"
        $sw = New-Object IO.StreamWriter($tmp, $false, (New-Object Text.UTF8Encoding $false))
        $n = 0
        while ($r.Read()) {
            $v = @()
            for ($i = 0; $i -lt $r.FieldCount; $i++) {
                $x = $r.GetValue($i)
                if ($x -is [DBNull]) { $x = '' }
                # `~` جوّه النص بيكسر الفاصل — بيتحوّل لشرطة. والسطر الجديد بيقطع الصف.
                $v += (([string]$x) -replace '[~]', '-' -replace "[`r`n`t]", ' ')
            }
            $sw.WriteLine(($v -join '~'))
            $n++
        }
        $sw.Close(); $r.Close()
        Move-Item -Force $tmp $outPath
        return $n
    } finally { $c.Close() }
}

Say '===== بداية التزامن ====='
$failed = $false

foreach ($b in $Branches) {
    Say ("-- {0} ({1}) --" -f $b.Name, $b.Db)
    if (-not (Test-Path $b.Dir)) { New-Item -ItemType Directory -Force $b.Dir | Out-Null }
    foreach ($e in $Exports) {
        try {
            $n = Export-A5 $b.Db (Join-Path $SqlDir $e.Sql) (Join-Path $b.Dir $e.Out)
            Say ("  تصدير {0,-18} {1,7} صف" -f $e.Out, $n)
        } catch {
            Say ("  ✘ فشل تصدير {0}: {1}" -f $e.Out, $_.Exception.Message)
            $failed = $true
        }
    }
}

if ($failed) {
    # الاستيراد مابيشتغلش على تصدير ناقص. نص كشف بيتقري كأنه كامل، والمستوردين
    # بيتخطوا الموجود — فاللي ناقص بيفضل ناقص ومحدش بيعرف.
    Say '✘ التصدير فشل — الاستيراد اتلغى. الداتا زي ما هي.'
    exit 1
}

foreach ($b in $Branches) {
    foreach ($mod in @('import_a5_docs', 'import_a5_ledger')) {
        Say ("-- {0} · {1} --" -f $b.Name, $mod)
        $pyArgs = @('-m', "src.scripts.$mod", '--dir', $b.Dir, '--branch', $b.Name, '--yes')
        if ($b.Prefix) { $pyArgs += @('--prefix', $b.Prefix) }
        Push-Location "$Root\backend"
        try {
            $env:PYTHONIOENCODING = 'utf-8'
            $out = & $Py @pyArgs 2>&1
            $tail = ($out | Select-Object -Last 6) -join ' | '
            Say ("  {0}" -f $tail)
            if ($LASTEXITCODE -ne 0) { Say ("  ✘ كود الخروج {0}" -f $LASTEXITCODE); $failed = $true }
        } finally { Pop-Location }
    }
}

if ($failed) { Say '✘ خلص وفيه فشل' } else { Say '✔ خلص تمام' }
if ($failed) { exit 1 }
