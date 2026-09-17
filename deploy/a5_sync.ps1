# تزامن يومي مع a5 — بيصدّر كل حاجة من a5 وبيستورد الحركة الجديدة عندنا.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\techno\deploy\a5_sync.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\techno\deploy\a5_sync.ps1 -ExportOnly
#
# ⚠️ **قواعد a5 قراءة بس.** السكربت ده `SELECT` وخلاص — مافيش `INSERT` ولا `UPDATE`
# ولا حتى جدول مؤقت. الشركة شغّالة عليهم دلوقتي ومافيش نسخة نرجّع منها.
# **وقاعدة `ERP` ممنوعة خالص** — مش هنا ولا في أي مكان.
#
# ---------------------------------------------------------------------------
# **ليه أصلاً:** النقل الأصلي لقطة. قِسنا الفرق: آخر حركة عندنا ٢٩ أغسطس، وa5 كمّل
# ٣٠ و٣١ و١ و٢ و٣ سبتمبر — ١٬١٠٨ سطر دفتر و١٧٦ فاتورة. والفرق بيكبر كل يوم طول ما
# الشركة شغّالة على النظامين.
#
# **التصدير كامل مش المستندات بس.** استعلامات التصدير الأساسية (أصناف، عملاء، شجرة،
# جرد افتتاحي…) اتعملت مرة في ٢٩ أغسطس وضاعت — ماكانتش في الريبو. لما احتجنا نعيد
# البناء من الصفر ماكانش فيه غير لقطة بايتة أسبوع. فكل استعلام دلوقتي في
# `deploy\a5_sql\` وبيتشغّل هنا كل ليلة، والتصدير الكامل محفوظ ومايضيعش تاني.
# `-ExportOnly` بيوقف بعد التصدير — ده اللي إعادة البناء بتستعمله.
#
# **بيصدّر الكل مش الجديد بس، عن قصد.** المستوردين بيتخطوا الموجود (المستند
# برقمه، والقيد بـ`external_ref`)، فإعادة التصدير الكاملة بتلقّط كمان **التعديل
# الرجعي**: فاتورة اتظبطت بتاريخ قديم، أو سطر اتصلّح. الفلترة بالتاريخ كانت هتفوّتهم
# ومحدش هيعرف. والتكلفة دقايق، والدقة تستاهل.
#
# **الفاصل `~` مش tab** في ملفات `a5_*.tsv` — ده اللي `import_a5._read` بيقراه.
# و`~` جوّه القيم بيتحوّل لشرطة، فالاستعلامات بتطلّع أعمدة حقيقية مش نص متسلسل.
# ملفات الكشوف (`emp_*`, `cust_*`, `acc_*`) بفاصل tab وصف عناوين — دي بتتقرا
# بـ`csv.DictReader`، والفاصل والرأس جزء من عقدها.
#
# **الاستيراد اليومي مستندات وقيود بس.** `import_a5` (الأصناف والعملاء) مش في السلسلة
# اليومية عن قصد: بعد دمج «تكنو فلان» مع «فلان»، إعادة قراءة كشف العملاء كل ليلة
# كانت هتعيد خلق الكارت المقفول. الكيانات الجديدة بتتضاف بقرار مش بجدول زمني.
param([switch]$ExportOnly)
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

# فرع → (قاعدة a5، مجلد التصدير، اسم الفرع عندنا، بادئة الأكواد، وسم ملفات الكشوف)
$Branches = @(
    @{ Db = 'aliaa2026';  Dir = 'C:\pgtmp\aliaa'; Name = 'العلياء'; Prefix = 'AL-'; Tag = 'AL'  },
    @{ Db = 'Techno2026'; Dir = 'C:\pgtmp';       Name = 'أكتوبر';  Prefix = '';    Tag = 'OCT' }
)

# ملف الاستعلام → الملف اللي المستوردين بيقروه (بفاصل ~ من غير رأس)
$Exports = @(
    @{ Sql = 'exp_cats.sql';  Out = 'a5_cats.tsv'     },
    @{ Sql = 'exp_items.sql'; Out = 'a5_items.tsv'    },
    @{ Sql = 'exp_misc.sql';  Out = 'a5_misc.tsv'     },
    @{ Sql = 'exp_cust.sql';  Out = 'a5_cust.tsv'     },
    @{ Sql = 'exp_tree.sql';  Out = 'a5_acc.tsv'      },
    @{ Sql = 'exp_open.sql';  Out = 'a5_open.tsv'     },
    @{ Sql = 'exp_emp.sql';   Out = 'a5_emp.tsv'      },
    @{ Sql = 'exp_hdr.sql';   Out = 'a5_hdr.tsv'      },
    @{ Sql = 'exp_lines.sql'; Out = 'a5_lines.tsv'    },
    @{ Sql = 'exp_acc.sql';   Out = 'a5_acclines.tsv' },
    @{ Sql = 'exp_bal.sql';   Out = 'a5_bal.tsv'      },
    # رصيد الصنف **في كل مخزن** — للتحقق. `exp_bal.sql` بيدّي رصيد الشركة كلها،
    # وده بيدّي توزيعه: نفس الإجمالي ممكن يتوزّع غلط على المخازن والرقم الكلي يفضل
    # مظبوط وماحدش ياخد باله.
    @{ Sql = 'exp_bal_by_store.sql'; Out = 'a5_bal_store.tsv' }
)

# كشوف بفاصل tab وصف عناوين. المسار فيه {tag} أو {db} بيتبدّل بالفرع.
$Rosters = @(
    @{ Sql = 'exp_roster_emp.sql';  Out = 'C:\pgtmp\emp_{tag}.tsv' },
    @{ Sql = 'exp_roster_cust.sql'; Out = 'C:\pgtmp\cust_{db}.tsv' },
    @{ Sql = 'exp_roster_acc.sql';  Out = 'C:\pgtmp\acc_{db}.tsv'  }
)

function Export-A5 ($db, $sqlPath, $outPath, $sep = '~', [bool]$header = $false) {
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
        if ($header) {
            $cols = @(); for ($i = 0; $i -lt $r.FieldCount; $i++) { $cols += $r.GetName($i) }
            $sw.WriteLine(($cols -join $sep))
        }
        $n = 0
        while ($r.Read()) {
            $v = @()
            for ($i = 0; $i -lt $r.FieldCount; $i++) {
                $x = $r.GetValue($i)
                if ($x -is [DBNull]) { $x = '' }
                $s = ([string]$x) -replace "[`r`n`t]", ' '
                # الفاصل جوّه النص بيكسر الصف — `~` بيتحوّل لشرطة. مع tab مافيش لزوم.
                if ($sep -eq '~') { $s = $s -replace '[~]', '-' }
                $v += $s
            }
            $sw.WriteLine(($v -join $sep))
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
    foreach ($e in $Rosters) {
        $out = $e.Out -replace '\{tag\}', $b.Tag -replace '\{db\}', $b.Db
        try {
            $n = Export-A5 $b.Db (Join-Path $SqlDir $e.Sql) $out "`t" $true
            Say ("  كشف   {0,-18} {1,7} صف" -f (Split-Path $out -Leaf), $n)
        } catch {
            Say ("  ✘ فشل كشف {0}: {1}" -f (Split-Path $out -Leaf), $_.Exception.Message)
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

if ($ExportOnly) {
    Say '✔ تصدير بس — خلص.'
    exit 0
}

# **المستند اللي اتعدّل في a5 بعد ما نقلناه بيتهد ويتبني تاني — قبل الاستيراد.**
#
# `import_a5_docs` بيتخطّى المستند اللي رقمه موجود، وده اللي بيخلّيه آمن يتعاد كل ليلة.
# بس العميل بيعدّل مستنداته عندهم بعد النقل — سطر يتزاد، كمية تتغيّر — والتخطّي بيخلّي
# نسختنا مجمّدة على اللي كان، وبيبان كفرق في الرصيد مالوش تفسير. `rebuild_a5_docs` بيشيل
# نسختنا بالكامل (سطورها وحركات مخزونها) ويسيب الاستيراد يبنيها من أول وجديد، فالتحويلات
# والمخزون بيرجعوا مطابقين. ومابيلمسش مستند إحنا عملناه — بيشتغل على اللي في تصدير a5 بس.
foreach ($b in $Branches) {
    Say ("-- {0} · rebuild_a5_docs --" -f $b.Name)
    $pyArgs = @('-m', 'src.scripts.rebuild_a5_docs', '--dir', $b.Dir, '--branch', $b.Name, '--yes')
    if ($b.Prefix) { $pyArgs += @('--prefix', $b.Prefix) }
    Push-Location "$Rootackend"
    try {
        $env:PYTHONIOENCODING = 'utf-8'
        $out = & $Py @pyArgs 2>&1
        Say ("  " + (($out | Select-Object -Last 4) -join ' | '))
        if ($LASTEXITCODE -ne 0) { Say ("  X كود الخروج {0}" -f $LASTEXITCODE); $failed = $true }
    } finally { Pop-Location }
}

# **والحساب اللي الدفتر بيقيّد عليه بيتعمل قبل القيود.**
#
# `import_a5_ledger` بيتخطّى **سطر** القيد لو حسابه مش موجود — مش القيد كله. فالقيد بينزل
# بطرف واحد، وبيفضل كده للأبد لأن `external_ref` بتاعه اتكتب والتشغيلة اللي بعديها
# بتتخطّاه حتى بعد ما الحساب يتعمل. اتقاس: قيد واحد (`a5:AL-119625`) قعد بمدين ١٤٥٬٠٥٠
# ومن غير دائن، لأن حساب «تكنو بايت» اتعمل بعد الاستيراد بيوم. والليلة اللي بيتعمل فيها
# تاجر جديد وبيتباع له في نفس اليوم هي بالظبط اللي بتعيد السباق ده.
foreach ($b in $Branches) {
    Say ("-- {0} · add_missing_a5_accounts --" -f $b.Name)
    $pyArgs = @('-m', 'src.scripts.add_missing_a5_accounts', '--dir', $b.Dir, '--branch', $b.Name, '--yes')
    if ($b.Prefix) { $pyArgs += @('--prefix', $b.Prefix) }
    Push-Location "$Rootackend"
    try {
        $env:PYTHONIOENCODING = 'utf-8'
        $out = & $Py @pyArgs 2>&1
        Say ("  " + (($out | Select-Object -Last 3) -join ' | '))
        if ($LASTEXITCODE -ne 0) { Say ("  X كود الخروج {0}" -f $LASTEXITCODE); $failed = $true }
    } finally { Pop-Location }
}

# **والقيد اللي اتعدّل بيتهد كمان — مش المستند بس.**
#
# `import_a5_ledger` بيتخطّى القيد اللي `external_ref` بتاعه موجود، فالقيد اللي اتعدّل عند
# العميل بيفضل مجمّد. والمستند بيتصلّح (الخطوة اللي فوق) والقيد لأ — فالفاتورة بتقول رقم
# وكشف الحساب بيقول رقم تاني، ومحدش يعرف مين الصح. اتقاس: ١٧ قيد بـ٣٧٨ ألف جنيه على
# الفرعين. `rebuild_a5_ledger` بيشيلهم ويفك ربطهم بالفواتير، والاستيراد اللي بعده بيبنيهم
# ويربطهم تاني.
foreach ($b in $Branches) {
    Say ("-- {0} · rebuild_a5_ledger --" -f $b.Name)
    $pyArgs = @('-m', 'src.scripts.rebuild_a5_ledger', '--dir', $b.Dir, '--branch', $b.Name, '--yes')
    if ($b.Prefix) { $pyArgs += @('--prefix', $b.Prefix) }
    Push-Location "$Rootackend"
    try {
        $env:PYTHONIOENCODING = 'utf-8'
        $out = & $Py @pyArgs 2>&1
        Say ("  " + (($out | Select-Object -Last 3) -join ' | '))
        if ($LASTEXITCODE -ne 0) { Say ("  X كود الخروج {0}" -f $LASTEXITCODE); $failed = $true }
    } finally { Pop-Location }
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

# ── التصحيحات اللي لازم تتعاد بعد كل استيراد ──
#
# **`Emali_aftr` عند a5 مكسور على ١٬٤٣٩ فاتورة** — بيرجع صفر والسطور والقيد بقيمة
# حقيقية. اتقاس: مجموع `emali_aftax` بيطابق مجموع سطور `a_price` لحد القروش، بينما
# `Emali_aftr` أقل بـ١٫٣ مليون. الاستيراد بياخد الحقل زي ما هو، فكل تزامن بيجيب
# فواتير جديدة صافيها صفر — أول تشغيلة جابت ٢٠ فاتورة بـ٥٨٬٤٥٤ ج مخفية.
#
# فالتصحيح جزء من التزامن مش خطوة بتتفتكر. والسكربت بيتحقق إن `gross` بيساوي مجموع
# السطور قبل ما يكتب، واللي مايطابقش بيتقال ومايتغيّرش.
Say '-- تصحيحات ما بعد الاستيراد --'
Push-Location "$Root\backend"
try {
    $env:PYTHONIOENCODING = 'utf-8'
    $out = & $Py -m src.scripts.fix_zero_net_invoices --yes 2>&1
    Say ("  " + (($out | Select-Object -Last 3) -join ' | '))
    if ($LASTEXITCODE -ne 0) { Say ("  X كود الخروج {0}" -f $LASTEXITCODE); $failed = $true }
} finally { Pop-Location }

if ($failed) { Say '✘ خلص وفيه فشل' } else { Say '✔ خلص تمام' }
if ($failed) { exit 1 }
