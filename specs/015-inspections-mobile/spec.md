# 015 — المعاينات (Site Inspections) + تطبيق الموبايل Flutter

## الهدف
تطبيق موبايل للمناديب يسجل **معاينات المواقع** (زيارات الفنيين + الزيارات العادية) أوفلاين،
ويزامنها مع السيرفر — بديل أحدث وأجمل من تطبيق A5Group القديم.

## Backend (FastAPI)
- **Models** (`models/inspection.py`): `Inspection` (header بكل حقول المواصفة: كود المستند،
  التاريخ، بيانات المالك [اسم/تليفون/بطاقة/عنوان/دور]، توصيف المعاينة، نوع المعاينة، بيانات
  الفني، محل الشراء، تفاصيل الزيارة، إجمالي النقاط، المندوب) + `InspectionItem`
  (صنف/كمية/نقاط/إجمالي = نقاط×كمية). **مستند معلوماتي فقط** — لا مخزون ولا قيود.
- **Offline sync**: `client_uuid` يتولد على الجهاز و unique — إعادة رفع نفس الدفعة no-op
  (idempotent). `POST /inspections/sync` يستقبل batch ويرجع mapping uuid → document_number.
- **API**: `POST /inspections`, `POST /inspections/sync`, `GET /inspections`
  (فلاتر kind/date/rep — المندوب مقيد على معايناته)، `GET /inspections/{id}`.
- **RBAC**: `CAP_INSPECTION_READ/WRITE` — admin/branch_manager/sales_manager/after_sales/rep.
- **Lookups** (013): `inspection_description` (حمام و مطبخ، حمام فقط، مطبخ فقط، 2 حمام و مطبخ،
  مرمه، محل، مسجد، صيدليه، 2 حمام) و `inspection_type` (تغذية و صرف، تغذية فقط، صرف فقط) —
  قوائم حرة تتعدل من شاشة الإعدادات.
- `GET /products/point-values`: كل قيم النقاط دفعة واحدة (كاش الموبايل).
- Migration `0015_inspections` + startup `create_all` يغطي السيرفر.

## Mobile (Flutter — `mobile/`)
- عربي RTL، Material 3، ثيم Techno Therm (أزرق بترولي + أصفر).
- الشاشات: دخول → الرئيسية (**الزيارات** / **مراجعة الزيارات** + بادج المعلقات) →
  زيارات الفنيين / الزيارات العادية → فورم المعاينة (أقسام: الزيارة/المالك/التفاصيل/الفني/
  إضافية/الأصناف) → اختيار صنف ببحث (كمية + نقاط تلقائية من الكتالوج) → سلة الملخص →
  حفظ محلي → مراجعة بالتاريخ (متزامنة/معلقة، حذف المعلقة فقط) → شاشة المزامنة
  (رفع المعاينات + تحديث الأصناف والقوائم + عنوان السيرفر).
- **Offline-first**: sqflite (معاينات + كتالوج + قوائم + جلسة). الدخول أونلاين مرة واحدة،
  الشغل بعدها كله أوفلاين، والمزامنة عند توفر النت.
- APK: `flutter build apk --release` → `mobile/build/app/outputs/flutter-apk/app-release.apk`.
  (ملاحظة بيئة: البناء يحتاج TEMP قصير — `TMP=C:\t` — بسبب حد طول مسار unix socket في JVM.)

## Web (React)
- صفحة **المعاينات** (`pages/Inspections.tsx`): إحصائيات + جدول بفلاتر (فترة/نوع/مندوب) +
  Drawer تفاصيل كامل بالأصناف والنقاط. في القائمة لـ admin/branch_manager/sales_manager/after_sales.

## الاختبارات
`tests/integration/test_inspections.py` — الإنشاء والإجماليات، idempotency للمزامنة،
تقييد المندوب، الفلاتر، الفاليديشن، الـ RBAC، والقوائم المبذورة. (308 passed كامل السويت.)
