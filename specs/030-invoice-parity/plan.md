# Implementation Plan: توسعة مستندات البيع والشراء (مضاهاة a5system)

**Branch**: `030-invoice-parity` | **Date**: 2026-07-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/030-invoice-parity/spec.md`

## Summary

توسعة المستندات الأربعة (فاتورة بيع · مرتجع بيع · فاتورة شراء · مرتجع شراء) بحيث:
**المخزن ينزل من مستوى المستند لمستوى السطر**، والطرف يتحدد من **نافذة موحّدة** فيها إنشاء
سريع، والمستند يكتسب **مندوب وحساب ورقم مستند خارجي وملاحظات وثلاث بيانات**، وكل سطر بيع
يخزّن **تكلفة الوحدة وقت البيع**.

النهج: **تعديل واحد في طبقة الخدمات** يخدم المستندات الأربعة، مع **ترحيل غير هدّام** يحطّ
مخزن المستند على السطور القديمة فتفضل صحيحة.

## Technical Context

**Language/Version**: Python 3.12 (3.11 dev) · TypeScript 5 / React 18
**Primary Dependencies**: FastAPI · SQLAlchemy 2.x · Alembic · Pydantic v2 · Ant Design v5 (RTL)
**Storage**: MySQL 8 / MariaDB 10.6+ (InnoDB, utf8mb4) — `MONEY` DECIMAL(18,2) · `QTY` DECIMAL(18,3)
**Testing**: pytest (integration-first، اختبارات أولاً للمنطق الحرج — الدستور X)
**Target Platform**: ويب (Vercel) + API (api.technothermeg.com)
**Project Type**: Web application (backend + frontend)
**Performance Goals**: شاشة الفاتورة تفضل تفاعلية مع ٥٠+ سطر؛ أرصدة المخزن للمخزن المختار
تتحمّل بنداء واحد مش نداء لكل سطر.
**Constraints**: **لا رصيد سالب** على مستوى المخزن لكل سطر · كل الحركات تمرّ من
`stock_service.post_movement` · العكس يرجّع كل سطر لمخزنه · المستندات القديمة تفضل صحيحة.
**Scale/Scope**: ٤ شاشات · ٥ قصص مستخدم · ١٨ متطلب وظيفي.

## Constitution Check

| المبدأ | الالتزام |
|---|---|
| **I. Greenfield Only** | مفيش نسخ كود/تصميم من a5system — الوظيفة بس، بثيمنا وكودنا. |
| **II. Single Source of Truth** | كل الحقول الجديدة تظهر في OpenAPI؛ الويب والموبايل يستهلكوا نفس العقد. |
| **IV. Reversibility** | العكس يرجّع **كل سطر لمخزنه**؛ لا حذف ولا تعديل على المُرحّل. |
| **V. Multi-Branch & Multi-Warehouse** | ده جوهر الميزة — المخزن بقى على السطر. |
| **VI. Double-Entry** | القيد يفضل **واحد ومتزن** لكل مستند مهما تعددت مخازن السطور. |
| **VIII. Arabic RTL** | كل الحقول والرسائل عربي، والمستند المطبوع مبرنَد. |
| **X. Test-First (NON-NEGOTIABLE)** | اختبارات التكامل تتكتب **قبل** التنفيذ لكل قصة. |
| **XI. No Negative Stock** | الفحص بقى **لكل (صنف × مخزن)** وعلى **مجموع** سطور المستند. |

**Gate**: ✅ عدّى — مفيش مخالفة ولا استثناء مطلوب.

## Project Structure

### Documentation (this feature)

```
specs/030-invoice-parity/
├── spec.md      # المواصفة (مكتملة)
├── plan.md      # هذا الملف
└── tasks.md     # المهام (يولّدها /speckit.tasks)
```

### Source Code (repository root)

```
backend/
├── src/
│   ├── models/
│   │   ├── sales.py           # +warehouse على السطر · +rep/account/ext-doc/notes/بيان على المستند · +unit_cost
│   │   └── purchasing.py      # نفس التوسعة لمستندات الشراء
│   ├── services/
│   │   ├── sales_service.py   # السطر ياخد مخزنه · حساب التكلفة وقت البيع · فحص الإتاحة المجمّع
│   │   ├── purchasing_service.py
│   │   └── costing_service.py # جديد: متوسط التكلفة المرجّح لصنف في لحظة
│   └── api/
│       ├── sales.py           # المخططات الجديدة + فلترة بالمندوب/رقم المستند
│       └── purchases.py
├── migrations/versions/
│   └── 0028_invoice_parity.py # أعمدة جديدة + ترحيل مخزن المستند للسطور القديمة
└── tests/integration/
    ├── test_invoice_multi_warehouse.py
    ├── test_invoice_document_fields.py
    └── test_sale_cost_at_sale.py

frontend/src/
├── components/
│   ├── PartyPickerModal.tsx   # جديد: نافذة اختيار الطرف + إنشاء سريع
│   └── DocumentLinesTable.tsx # جديد: سطور بمخزن لكل سطر (مشترك بين الأربعة)
└── pages/
    ├── Invoices.tsx · Returns.tsx · Purchases.tsx
```

**Structure Decision**: Web application (backend + frontend). المنطق المشترك يتحطّ في
`costing_service` جديد ومكوّنين واجهة مشتركين، عشان المستندات الأربعة تستهلك نفس الكود بدل
تكرار في أربع شاشات.

## Phasing (ترتيب التنفيذ)

| المرحلة | المحتوى | القصة |
|---|---|---|
| **P0** | الموديل + الترحيل: أعمدة السطر والمستند + `0028` + الـ startup schema-sync | تمكين |
| **P1** | **مخزن لكل سطر** في الخدمات: فحص الإتاحة المجمّع لكل (صنف×مخزن)، الحركات لكل سطر، العكس لمخزنه | US1 |
| **P2** | **تكلفة البيع**: `costing_service.average_cost_at` + تخزينها على السطر + انعكاسها في المرتجع | US5 |
| **P3** | حقول المستند: مندوب · حساب · رقم مستند خارجي · ملاحظات · بيان١/٢/٣ + الفلترة | US3 |
| **P4** | **نافذة اختيار الطرف** + الرصيد والعنوان والهاتف في الرأس | US2 |
| **P5** | تعميم على المستندات الأربعة + الطباعة المبرنَدة | US4 |

كل مرحلة **قابلة للتسليم لوحدها** ومختبرة قبل اللي بعدها.

## Complexity Tracking

| المخاطرة | التخفيف |
|---|---|
| **المستندات القديمة** بمخزن على المستند بس | الترحيل يحطّ `origin` على كل سطر قديم؛ اختبار يثبت إن مستند قديم يتعرض ويتعكس صح |
| **فحص الإتاحة** لو اتعمل لكل سطر لوحده يسمح بتجاوز | الفحص على **مجموع** الكميات لكل (صنف × مخزن) قبل أي حركة |
| **التكلفة** بعد التفعيل بس | موثّق في السبيك؛ تقارير الربح توضّح الفواتير الأقدم من التفعيل |
| تكرار الكود في ٤ شاشات | مكوّنان مشتركان (`PartyPickerModal` · `DocumentLinesTable`) ودالة خدمة واحدة |
