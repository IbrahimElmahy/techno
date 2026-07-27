# Tasks: توسعة مستندات البيع والشراء (مضاهاة a5system)

**Input**: [spec.md](./spec.md) · [plan.md](./plan.md)
**Tests**: مطلوبة — الدستور **X (Test-First، غير قابل للتفاوض)** لأن ده منطق مخزون ومحاسبة حرج.

## Format: `[ID] [P?] [Story] Description`

- **[P]** = يمكن تنفيذها بالتوازي (ملفات مختلفة، مفيش تبعية)
- **[Story]** = القصة اللي المهمة بتخدمها (US1…US5)

## Path Conventions

`backend/src/...` · `backend/tests/integration/...` · `frontend/src/...`

---

## Phase 1: Setup (Shared Infrastructure)

- [ ] **T001** إنشاء فرع `030-invoice-parity` من `main`.
- [ ] **T002** توثيق نقطة البداية: تشغيل السويت كاملة وتسجيل العدد الحالي (٤٠٠) كخط أساس.

---

## Phase 2: Foundational (Blocking Prerequisites)

> ⚠️ كل القصص متوقفة على المرحلة دي — الأعمدة والترحيل لازم يخلصوا الأول.

- [ ] **T003** [US1] `models/sales.py`: `SalesInvoiceLine` +`location_kind` +`location_id`
      (nullable — القديم بياخدهم بالترحيل)؛ `SalesReturnLine` نفس الحاجة.
- [ ] **T004** [US5] `models/sales.py`: `SalesInvoiceLine.unit_cost` (`MONEY`، nullable —
      القديم من غير تكلفة) + `SalesReturnLine.unit_cost`.
- [ ] **T005** [US3] `models/sales.py`: `SalesInvoice` +`rep_id` +`revenue_account_id`
      +`external_document_number` +`notes` +`statement1..3`؛ ونفسها على `SalesReturn`.
- [ ] **T006** [P] [US1/US3] `models/purchasing.py`: نفس التوسعة لمستندات الشراء ومرتجعاتها.
- [ ] **T007** Migration `0028_invoice_parity.py`: إضافة كل الأعمدة + **ترحيل**: نسخ
      `origin_location_kind/id` من المستند لكل سطر قديم (لا هدم، لا فقدان).
- [ ] **T008** `main.py`: إضافة الأعمدة الجديدة لـ `_ADDED_COLUMNS` (مزامنة السكيما عند الإقلاع).
- [ ] **T009** التحقق: تشغيل السويت كاملة — لازم تفضل **٤٠٠ ناجحة** (مفيش انحدار قبل أي منطق جديد).

**Checkpoint**: السكيما جاهزة والمستندات القديمة سليمة.

---

## Phase 3: User Story 1 - مخزن لكل سطر (P1) 🎯 MVP

### Tests for User Story 1 ⚠️ تتكتب وتفشل قبل التنفيذ

- [ ] **T010** [P] [US1] `test_invoice_multi_warehouse.py::test_sale_from_two_warehouses_deducts_each`
- [ ] **T011** [P] [US1] `...::test_sum_of_lines_over_available_in_one_warehouse_rejected`
      (سطرين ٣+٣ على رصيد ٥ → مرفوض — يحمي من ثغرة الفحص لكل سطر لوحده)
- [ ] **T012** [P] [US1] `...::test_reversal_returns_each_line_to_its_own_warehouse`
- [ ] **T013** [P] [US1] `...::test_legacy_invoice_still_reads_and_reverses` (مستند قديم بعد الترحيل)

### Implementation for User Story 1

- [ ] **T014** [US1] `sales_service.SaleLine` +`location_kind`/`location_id` (اختياريين —
      الفراغ = مخزن المستند الافتراضي).
- [ ] **T015** [US1] `sales_service.create_sale`: **فحص الإتاحة المجمّع** لكل (صنف × مخزن)
      قبل أي حركة، ثم حركة خروج **لكل سطر من مخزنه**.
- [ ] **T016** [US1] `sales_service`: العكس/المرتجع يرجّع كل سطر **لمخزنه** بدل مخزن المستند.
- [ ] **T017** [P] [US1] نفس المنطق في `purchasing_service` (دخول لكل سطر لمخزنه).
- [ ] **T018** [US1] `api/sales.py` + `api/purchases.py`: السطر يقبل `warehouse_id` اختياري
      ويرجّعه في التفاصيل.
- [ ] **T019** [US1] تشغيل اختبارات القصة — لازم تعدّي كلها.

**Checkpoint**: US1 شغّالة ومختبرة ومستقلة.

---

## Phase 4: User Story 5 - تكلفة البيع (P1)

### Tests for User Story 5 ⚠️

- [ ] **T020** [P] [US5] `test_sale_cost_at_sale.py::test_cost_frozen_when_purchase_price_changes_later`
- [ ] **T021** [P] [US5] `...::test_item_without_purchases_stores_zero_cost_explicitly`
- [ ] **T022** [P] [US5] `...::test_return_mirrors_the_sale_unit_cost`

### Implementation for User Story 5

- [ ] **T023** [US5] `services/costing_service.py` (جديد): `average_cost(db, item_id)` —
      متوسط التكلفة المرجّح من المشتريات، دالة نقية قابلة لإعادة الاستخدام.
- [ ] **T024** [US5] `sales_service.create_sale`: تخزين `unit_cost` على كل سطر وقت الترحيل.
- [ ] **T025** [US5] المرتجع (المربوط والمستقل) يخزّن **نفس** تكلفة وحدة البيع.
- [ ] **T026** [US5] `api/sales.py`: `unit_cost` يظهر في تفاصيل المستند.
- [ ] **T027** [US5] تشغيل اختبارات القصة.

**Checkpoint**: كل بيع جديد بيتخزّن بتكلفة مثبّتة — الأرباح بقت قابلة للحساب بدقة.

---

## Phase 5: User Story 3 - حقول المستند (P2)

### Tests for User Story 3 ⚠️

- [ ] **T028** [P] [US3] `test_invoice_document_fields.py::test_rep_account_extdoc_notes_persist`
- [ ] **T029** [P] [US3] `...::test_filter_invoices_by_rep_and_external_document_number`

### Implementation for User Story 3

- [ ] **T030** [US3] `sales_service` + `purchasing_service`: قبول وتخزين مندوب/حساب/رقم
      مستند/ملاحظات/بيان١-٣ (الحساب يتحقق إنه صالح للترحيل).
- [ ] **T031** [US3] `api/sales.py` + `api/purchases.py`: المخططات + فلاتر `rep_id`
      و`external_document_number` على القوائم.
- [ ] **T032** [US3] تشغيل اختبارات القصة.

---

## Phase 6: User Story 2 - نافذة اختيار الطرف (P1 واجهة)

- [ ] **T033** [US2] `components/PartyPickerModal.tsx`: بحث + فلترة بالفرع + قائمة الأطراف
      (**عملاء** للبيع · **موردين** للشراء — قرار FR-015) + إنشاء سريع.
- [ ] **T034** [US2] الإنشاء السريع يستدعي نفس API إنشاء العميل/المورد ويحدد الطرف مباشرة
      **من غير فقدان** أي سطر مُدخل.
- [ ] **T035** [US2] رأس المستند يعرض: الاسم · **الرصيد الحالي** · العنوان · الهاتف.
- [ ] **T036** [US2] تحقّق في المتصفح: إنشاء عميل وسط فاتورة نصف مُدخلة من غير فقدان بيانات.

---

## Phase 7: User Story 4 - تعميم على المستندات الأربعة (P2)

- [ ] **T037** [US4] `components/DocumentLinesTable.tsx`: جدول سطور بمخزن لكل سطر + الأصناف
      المتاحة في مخزن السطر + سقف الكمية.
- [ ] **T038** [US4] تطبيق المكوّنين على `Invoices.tsx`.
- [ ] **T039** [P] [US4] تطبيقهم على `Returns.tsx`.
- [ ] **T040** [P] [US4] تطبيقهم على `Purchases.tsx` (فاتورة ومرتجع).
- [ ] **T041** [US4] الحقول الجديدة تظهر في `InvoiceDocument.tsx` (العرض والطباعة).
- [ ] **T042** [US4] تحقّق في المتصفح على **الأربعة**: نفس الحقول ونفس السلوك.

---

## Phase 8: Polish & Cross-Cutting

- [ ] **T043** تشغيل السويت كاملة — لازم **٤٠٠+ ناجحة، صفر فاشلة**.
- [ ] **T044** `npx tsc --noEmit` نضيف + كونسول المتصفح نضيف.
- [ ] **T045** تحقّق يدوي بالسيناريو الكامل: فاتورة من ٣ مخازن → عكسها → مراجعة الأرصدة.
- [ ] **T046** تحديث [029-a5web-parity/research.md](../029-a5web-parity/research.md): تعليم
      الفجوات المقفولة (S1–S10، P2 جزئياً).
- [ ] **T047** تحديث `CLAUDE.md` (Recent Changes) + `git push` بحساب **IbrahimElmahy**
      (بعد إذن العميل بالرفع).

---

## Dependencies & Parallel Execution

```
Phase 1 → Phase 2 (blocking)
          ├─→ Phase 3 (US1) ─┐
          └─→ Phase 4 (US5) ─┤   ← US1 و US5 مستقلتين بعد السكيما
                              ├─→ Phase 5 (US3)
                              └─→ Phase 6 (US2) → Phase 7 (US4) → Phase 8
```

**فرص التوازي**: T010–T013 · T020–T022 · T028–T029 (اختبارات في ملفات مختلفة) ·
T039–T040 (شاشات مختلفة) · T006 مع T003–T005 (ملفات موديل مختلفة).

**MVP**: Phase 1 → 2 → 3 (US1 لوحدها) = فاتورة من أكتر من مخزن — أكبر فجوة وظيفية، قابلة
للتسليم والعرض على العميل من غير باقي المراحل.
