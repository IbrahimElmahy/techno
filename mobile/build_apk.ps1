# اعمل APK للنشر.
#
# شغّله كده:  .\build_apk.ps1
#
# لازم يبقى سكريبت مش أمر بتكتبه بإيدك، بسبب سطر واحد: `JAVA_TOOL_OPTIONS`.
#
# Gradle fails on this machine with «Unable to establish loopback connection», which reads like a
# network problem and is not one — Java builds its internal pipes on AF_UNIX sockets and creates the
# socket file under `jdk.net.unixdomain.tmpdir`. Something rejects that path under the user profile,
# and a directory outside it works.
#
# `android/gradle.properties` already carries the same flag, and that is NOT enough: it applies to
# the Gradle DAEMON, while the failure happens in the LAUNCHER that starts before the daemon exists.
# The launcher only reads the environment. So the setting has to be here as well — and the reason it
# looked solved once and broke again later is that it was typed into a shell that then closed.
#
# **بيبني نوعين، الاتنين لازمين للتحديث من السيرفر** (`tool/publish_update.py`):
# ملف لكل معمارية (أصغر بالتلت — ده اللي التليفون بينزّله على نت الموبايل)، والعام
# (اللي بيتبعت بإيد لو احتجنا). ملفات المعماريات الأول: البناء العام بعدها مابيمسحهاش.
$ErrorActionPreference = 'Stop'

$socketDir = 'D:/jtmp'
if (-not (Test-Path $socketDir)) { New-Item -ItemType Directory -Force $socketDir | Out-Null }

$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=$socketDir -Djava.io.tmpdir=$socketDir"

Push-Location $PSScriptRoot
try {
    & C:\src\flutter\bin\flutter.bat build apk --release --split-per-abi
    if ($LASTEXITCODE -ne 0) { throw "بيلد المعماريات فشل — كود $LASTEXITCODE" }

    & C:\src\flutter\bin\flutter.bat build apk --release
    if ($LASTEXITCODE -ne 0) { throw "البيلد فشل — كود $LASTEXITCODE" }

    Write-Host ""
    Write-Host "تمام — الـAPKs جاهزة:" -ForegroundColor Green
    $dir = Join-Path $PSScriptRoot 'build\app\outputs\flutter-apk'
    foreach ($name in 'app-arm64-v8a-release.apk', 'app-armeabi-v7a-release.apk',
                      'app-x86_64-release.apk', 'app-release.apk') {
        $info = Get-Item (Join-Path $dir $name)
        Write-Host ("  {0}  {1:N1} ميجابايت — {2}" -f $info.Name, ($info.Length / 1MB), $info.LastWriteTime)
    }
    Write-Host ""
    Write-Host "للنشر على السيرفر:  python tool\publish_update.py --notes `"...`""
}
finally { Pop-Location }
