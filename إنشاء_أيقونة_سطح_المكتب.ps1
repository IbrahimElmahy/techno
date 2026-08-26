# PowerShell script to create Desktop Shortcut for Techno Therm System
$DesktopPath = [System.Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $DesktopPath "تكنو ثيرم - تشغيل النظام.lnk"

$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"d:\techno\run.ps1`""
$Shortcut.WorkingDirectory = "d:\techno"
$Shortcut.Description = "تشغيل نظام تكنو ثيرم (الباك إند والواجهة)"
$Shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll, 14"
$Shortcut.Save()

Write-Host "✓ تم التحديث: الأيقونة تعمل الآن بشكل مباشر عبر PowerShell بدون أخطاء الترميز." -ForegroundColor Green
