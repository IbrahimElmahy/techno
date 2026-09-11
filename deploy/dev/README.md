# نسخة الديف المحلية

نسخة كاملة من النظام بتشتغل على الجهاز ده، **منفصلة تماماً عن سيرفر العميل**.

## كل يوم

```powershell
cd D:\techno\deploy\dev
.\dev.ps1          # القاعدة + الباك إند + الواجهة
.\dev_pull.ps1     # يجيب نسخة جديدة من داتا السيرفر
```

| | |
|---|---|
| الواجهة | <http://localhost:5173> |
| الباك إند | <http://127.0.0.1:8000> · التوثيق `/docs` |
| القاعدة | `techno_dev` على `127.0.0.1:5433` (يوزر `techno` / `devpass`) |

اقفل نافذة `dev.ps1` توقف الكل — الباك إند والواجهة والقاعدة.

## التجهيز — مرة واحدة بس

بوستجرس محمول (مش مثبّت كخدمة) وكلستر خاص على منفذ ٥٤٣٣:

```powershell
# ١) نزّل البايناريز وفكّها
curl.exe -L -o D:\tools\pg16.zip https://get.enterprisedb.com/postgresql/postgresql-16.9-1-windows-x64-binaries.zip
Expand-Archive D:\tools\pg16.zip D:\tools\pg16

# ٢) اعمل الكلستر
New-Item -ItemType Directory -Force D:\techno-dev | Out-Null
Set-Content D:\techno-dev\pw.txt 'devpass' -NoNewline -Encoding ascii
D:\tools\pg16\pgsql\bin\initdb.exe -D D:\techno-dev\pgdata -U postgres --pwfile=D:\techno-dev\pw.txt -E UTF8 --locale=C
Remove-Item D:\techno-dev\pw.txt
(Get-Content D:\techno-dev\pgdata\postgresql.conf) -replace '^#?port\s*=.*', 'port = 5433' |
    Set-Content D:\techno-dev\pgdata\postgresql.conf

# ٣) شغّلها واعمل اليوزر والقاعدة
.\dev_db.ps1 start
$env:PGPASSWORD = 'devpass'
D:\tools\pg16\pgsql\bin\psql.exe -h 127.0.0.1 -p 5433 -U postgres -c "CREATE ROLE techno LOGIN PASSWORD 'devpass' SUPERUSER"
D:\tools\pg16\pgsql\bin\createdb.exe -h 127.0.0.1 -p 5433 -U postgres -O techno -E UTF8 -T template0 techno_dev
```

## ليه الشكل ده

**بوستجرس محمول مش مثبّت.** الجهاز ده عليه شغل تاني، وخدمة بتقوم مع الويندوز على
المنفذ الافتراضي بتزاحم أي حاجة تانية وبتفضل شغّالة وانت مش واخد بالك. دي بتقوم
وتقف بأمرك، وعلى **٥٤٣٣** فحتى لو فيه بوستجرس تاني مافيش تصادم. وكله تحت
`D:\techno-dev` — امسح المجلد ترجع من الأول.

**`DATABASE_URL` متغيّر بيئة مش في `.env`.** الملف ده بتاعك وممكن يكون مظبوط على
حاجة تانية؛ السكربت مالوش حق يدوس عليه. المتغيّر بيغلب الملف في `pydantic-settings`
وبيموت مع النافذة.

**اسم القاعدة ومنفذها مختلفين عن الإنتاج عن قصد** — عشان سطر اتنسخ بالغلط مايوصلش
لقاعدة العميل. و`dev_pull.ps1` بيرفض يكتب على أي اسم غير `techno_dev`.

**السحب اتجاه واحد.** مافيش سطر في المجلد ده بيكتب على السيرفر؛ بياخد `pg_dump`
ويمسح الملف المؤقت بعد التنزيل وخلاص. وقواعد a5 ممنوعة هنا زي أي مكان تاني —
شوف `CLAUDE.md`.

**الجداول بتتعمل لوحدها.** الباك إند بيعمل `create_all` ومزامنة الأعمدة أول ما
يقوم، فالقاعدة الفاضية بتشتغل من غير خطوة زيادة. `dev_pull.ps1` بيجيب الداتا.

## لو القاعدة مارضيتش تقوم

```powershell
Get-Content D:\techno-dev\pg.log -Tail 30
```

أشهر سبب: نسخة وقعت وسابت `postmaster.pid`. امسحه وشغّل تاني:

```powershell
Remove-Item D:\techno-dev\pgdata\postmaster.pid -Force
.\dev_db.ps1 start
```
