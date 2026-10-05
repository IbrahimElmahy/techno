# قراءة بس: بيشغّل ملف SELECT على قاعدة a5 ويكتب النتيجة في ملف (UTF-16).
param([string]$Sql, [string]$Out, [string]$Db = 'factory Pro2026')
$s = (Get-ChildItem 'C:\Program Files\Microsoft SQL Server','C:\Program Files (x86)\Microsoft SQL Server' -Recurse -Filter sqlcmd.exe -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
& $s -S . -E -d $Db -i $Sql -o $Out -W -s '~' -h -1 -u
