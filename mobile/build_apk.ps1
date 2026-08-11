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
$ErrorActionPreference = 'Stop'

$socketDir = 'D:/jtmp'
if (-not (Test-Path $socketDir)) { New-Item -ItemType Directory -Force $socketDir | Out-Null }

$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=$socketDir -Djava.io.tmpdir=$socketDir"

Push-Location $PSScriptRoot
try {
    & C:\src\flutter\bin\flutter.bat build apk --release
    if ($LASTEXITCODE -ne 0) { throw "البيلد فشل — كود $LASTEXITCODE" }

    $apk = Join-Path $PSScriptRoot 'build\app\outputs\flutter-apk\app-release.apk'
    $info = Get-Item $apk
    Write-Host ""
    Write-Host "تمام — الـAPK جاهز:" -ForegroundColor Green
    Write-Host "  $apk"
    Write-Host ("  {0:N1} ميجابايت — {1}" -f ($info.Length / 1MB), $info.LastWriteTime)
}
finally { Pop-Location }
