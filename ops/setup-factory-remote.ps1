<#
    ربط سيرفر المصنع من برّه — نفس تركيبة سيرفر العلياء بالظبط.

    سيرفر العلياء (`A5SERVER`) بيتوصل من أي مكان من غير AnyDesk وبغير IP ثابت
    وبغير فتح بورت في الراوتر، عن طريق حاجتين:

        OpenSSH Server   خدمة `sshd` شغّالة على ٢٢ محلياً، والدخول بمفتاح مش بباسورد.
        Cloudflare Tunnel  خدمة `Cloudflared` بتفتح اتصال **خارج** من الجهاز لكلاودفلير،
                           وكلاودفلير بتوصّل الاسم العام للبورت المحلي.

    والاتجاه ده هو المهم: الجهاز هو اللي بيتصل بكلاودفلير، مش العكس. فمافيش بورت
    مفتوح على النت، ومافيش IP لازم يفضل ثابت، والراوتر مايتلمسش.

    ---------------------------------------------------------------------------
    شغّل السكربت ده على **سيرفر المصنع** من PowerShell **As Administrator**:

        .\setup-factory-remote.ps1 -TunnelToken "<التوكن من كلاودفلير>"

    التوكن بيتجاب من لوحة Cloudflare Zero Trust — الخطوات في آخر الملف.

    بيعمل إيه:
      ١. يركّب OpenSSH Server ويشغّله ويخلّيه يقوم مع الويندوز.
      ٢. يحط المفتاح العام بتاعنا في `administrators_authorized_keys` بصلاحياته الصح.
      ٣. يقفل الدخول بالباسورد (المفتاح بس) — زي العلياء.
      ٤. ينزّل cloudflared ويركّبه كخدمة بالتوكن.

    **مابيلمسش a5 ولا SQL Server ولا أي داتا.** كله إضافة خدمات جنبهم.
#>
[CmdletBinding()]
param(
    # التوكن بتاع النفق من لوحة Cloudflare — سطر طويل بيبدأ بـ eyJ...
    [Parameter(Mandatory = $true)][string]$TunnelToken,

    # المفتاح العام اللي هيتسمح له بالدخول. الافتراضي هو مفتاح المصنع المولَّد عندنا.
    [string]$PublicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIaTs0kvL7JQus1Bw60UN0IrRPbr9Y7M+cPz81zXmIjY techno-factory'
)

$ErrorActionPreference = 'Stop'

function Step($n, $text) { Write-Host "`n[$n] $text" -ForegroundColor Cyan }

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "لازم تشغّله As Administrator."
}

# ----------------------------------------------------------------- ١. OpenSSH
Step 1 'OpenSSH Server'
$cap = Get-WindowsCapability -Online -Name 'OpenSSH.Server*'
if ($cap.State -ne 'Installed') {
    Write-Host '    بيتركّب...'
    Add-WindowsCapability -Online -Name $cap.Name | Out-Null
} else {
    Write-Host '    متركّب خلاص.'
}
Set-Service -Name sshd -StartupType Automatic
Start-Service sshd
# الجدار الناري: الاتصال جاي من نفس الجهاز (النفق)، بس القاعدة بتخلّي الشبكة
# المحلية توصله كمان — مفيدة لو حد جوّه المصنع عايز يدخل من غير النفق.
if (-not (Get-NetFirewallRule -Name 'sshd-22' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name 'sshd-22' -DisplayName 'OpenSSH Server (TCP 22)' `
        -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
}
Write-Host "    sshd: $((Get-Service sshd).Status)"

# ----------------------------------------------------------------- ٢. المفتاح
Step 2 'المفتاح العام'
# **ملف الأدمن مش ملف المستخدم.** الويندوز بيقرا مفاتيح أي عضو في مجموعة
# Administrators من الملف المشترك ده، مش من `C:\Users\<اسم>\.ssh\authorized_keys` —
# المفتاح اللي يتحط في التاني بيتجاهَل بصمت والدخول بيفضل بيطلب باسورد.
$keyFile = "$env:ProgramData\ssh\administrators_authorized_keys"
$existing = if (Test-Path $keyFile) { Get-Content $keyFile -Raw } else { '' }
if ($existing -notmatch [regex]::Escape(($PublicKey -split ' ')[1])) {
    Add-Content -Path $keyFile -Value $PublicKey -Encoding ascii
    Write-Host '    اتضاف.'
} else {
    Write-Host '    موجود خلاص.'
}
# **والصلاحيات شرط، مش تزويق.** sshd بيرفض الملف ويطلب باسورد من غير كلمة
# تفسّر ليه لو أي حد غير SYSTEM/Administrators ليه صلاحية عليه.
icacls $keyFile /inheritance:r /grant 'SYSTEM:F' /grant 'BUILTIN\Administrators:F' | Out-Null
Write-Host "    $keyFile"

# ----------------------------------------------------------------- ٣. مفتاح بس
Step 3 'قفل الدخول بالباسورد'
$cfg = "$env:ProgramData\ssh\sshd_config"
Copy-Item $cfg "$cfg.bak-$(Get-Date -Format yyyyMMdd-HHmmss)" -Force
$lines = Get-Content $cfg | Where-Object {
    $_ -notmatch '^\s*#?\s*(PasswordAuthentication|PubkeyAuthentication)\b'
}
$lines += 'PubkeyAuthentication yes'
$lines += 'PasswordAuthentication no'
Set-Content -Path $cfg -Value $lines -Encoding ascii
Restart-Service sshd
Write-Host '    الدخول بالمفتاح بس.'

# ----------------------------------------------------------------- ٤. النفق
Step 4 'Cloudflare Tunnel'
$dir = 'C:\Program Files (x86)\cloudflared'
$exe = Join-Path $dir 'cloudflared.exe'
if (-not (Test-Path $exe)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    Write-Host '    بينزّل cloudflared...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing `
        -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' `
        -OutFile $exe
}
Write-Host "    $((& $exe --version) -join ' ')"

# التوكن في ملف مش في سطر الأوامر — سطر أوامر الخدمة بيتقرا من أي حد على الجهاز.
$tokenDir = 'C:\ProgramData\cloudflared'
New-Item -ItemType Directory -Path $tokenDir -Force | Out-Null
$tokenFile = Join-Path $tokenDir 'token'
Set-Content -Path $tokenFile -Value $TunnelToken.Trim() -NoNewline -Encoding ascii
icacls $tokenFile /inheritance:r /grant 'SYSTEM:F' /grant 'BUILTIN\Administrators:F' | Out-Null

if (Get-Service Cloudflared -ErrorAction SilentlyContinue) {
    Write-Host '    الخدمة موجودة — بتتشال وتتركّب من جديد بالتوكن الجديد.'
    & $exe service uninstall 2>&1 | Out-Null
    Start-Sleep -Seconds 2
}
# نفس سطر تشغيل سيرفر العلياء بالحرف.
sc.exe create Cloudflared binPath= "`"$exe`" tunnel run --token-file $tokenFile" `
    start= auto DisplayName= "Cloudflare Tunnel" | Out-Null
Start-Service Cloudflared
Start-Sleep -Seconds 4
Write-Host "    Cloudflared: $((Get-Service Cloudflared).Status)"

Write-Host "`nخلص. من جهاز بعيد:  ssh <الاسم-العام>" -ForegroundColor Green

<#
    ---------------------------------------------------------------------------
    خطوات لوحة Cloudflare (مرة واحدة، قبل ما تشغّل السكربت):

      ١. https://one.dash.cloudflare.com  ←  Networks  ←  Tunnels  ←  Create a tunnel
      ٢. النوع: Cloudflared. الاسم: techno-factory
      ٣. الصفحة هتوريك أمر تركيب فيه توكن طويل بيبدأ بـ eyJ — **انسخ التوكن ده وبس**
         (اللي بعد `--token`)، وده اللي بيتحط في `-TunnelToken`.
      ٤. Next  ←  Public Hostnames  ←  Add a public hostname:
             Subdomain: factory
             Domain:    technothermeg.com
             Type:      SSH
             URL:       localhost:22
      ٥. Save.

    وبعدها من جهازك:  ssh factory.technothermeg.com
    (الإعداد اتضاف في ~/.ssh/config عندنا خلاص.)
#>
