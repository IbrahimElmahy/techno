# A5Group → Techno — Page-by-Page Review & Gap Plan (مراجعة شاشة-بشاشة)

> **Goal**: Replicate **all** of A5Group's logic/features in our system (the **features**, not the
> code — Principle I), screen by screen; then later strip what we don't want. This is the living
> work-plan: we take each screen, compare, and modify. TechnoLight is out of scope for now.
>
> **Legend** — Status: ✅ done · 🟡 partial · 🔴 missing · ⚠️ constitution decision needed.
> Source: static extraction from `A5Group_Acc.exe` (see [A5Group_System_Map.md](A5Group_System_Map.md)).

---

## PHASE 0 — Setup & Master Data (التعريفات الأساسية)

### S01 — تعريف المنشأة / الشركة والفروع (Company & Branches) — `Cmp_Brn`
- **A5G**: company definition, multiple companies + branches.
- **Ours**: ✅ branches + territories (single company). Multi-company ⚠️ (out of our scope — decision).
- **Gap/Action**: 🟡 add company/establishment profile (name, tax card, commercial register, logo for print). Keep single-company unless amended.

### S02 — العملات وأسعارها (Currencies) — `CurTyps / CurN / CurPrc`
- **A5G**: currency types, names, rates; sell/cost in foreign currency; "السؤال عن العملة" per invoice; per-item foreign price.
- **Ours**: 🔴 EGP only (Principle VIII). **⚠️ Constitution decision** before building multi-currency.
- **Action**: decide first; if approved → amendment + `money` gains currency + rate dimension.

### S03 — مراكز التكلفة (Cost Centers) — *new dimension*
- **A5G**: cost centers asked on sale/purchase; "تثبيت مركز التكلفة للحافظة"; per-line cost center.
- **Ours**: 🔴 missing entirely.
- **Action**: 🔴 add a Cost Center master + an optional `cost_center_id` dimension on ledger lines / documents.

### S04 — المستخدمون والصلاحيات (Users & ~350 permissions) — `Your_Err`
- **A5G**: users (`User_n`, `Your_Name`, `Boss`), per-user ~350 flags (`ChkUsr2/N/V4`): sell-below-tier, allow negative stock, allow edit/delete, prompts, defaults, audit-keep.
- **Ours**: ✅ 6 roles + capability map (deny-by-default), audit log.
- **Gap**: 🟡/⚠️ granular per-user flags. **Decision**: keep role-based, OR add a fine-grained permission layer. Recommend: extend capabilities with the high-value flags (sell-below-price, allow-edit/delete, period-lock) rather than 350 raw flags.

### S05 — دليل الحسابات (Chart of Accounts) — `acc_main / accBrnch`
- **A5G**: hierarchical tree (main → sub / analytical), opening balances, account code with slash separator, account types.
- **Ours**: 🔴 **biggest gap** — we have fixed account types only, no user-defined hierarchical chart.
- **Action**: 🔴 **Spec 004 core** — hierarchical Chart of Accounts; our fixed accounts (treasury, receivable…) become nodes/links.

### S06 — كارت الصنف (Item Card) — items
- **A5G features**: code (slash), name, **category/group tree** (شجرة الأصناف), **multiple units + conversion factor (معادل)**, **5 price tiers** (تجارى/نصف تجارى/جملة/نصف جملة/مستهلك), **barcode** (+ scale barcode prefix), **serial numbers** (manual/print/search), **min/max limits**, **expiry date**, cost method (average / last-purchase / import cost), **time-phased price-change table**, profit %, cost-center binding.
- **Ours**: 🟡 product/raw item, ONE fixed sale price, decimal qty + unit, system code, stock per location.
- **Gaps**: 🔴 category tree, multi-unit+factor, 5 price tiers, barcode, serials, min/max, expiry, cost valuation method, time-phased pricing.
- **Action**: large — split into sub-features (pricing tiers, units, serials, barcode, expiry/limits, valuation).

### S07 — العملاء (Customer Card) — `Cust`
- **A5G**: name, code, **activity (النشاط)**, phone(s)/phone directory, **fixed & variable address**, nickname (لقب), **default rep + sector (قطاع)**, **credit limit (block sales over limit)**, **due-term limit (block over آجل)**, indicative price, classification.
- **Ours**: 🟡 customer (code, type, phone, rep, territory, receivable account).
- **Gaps**: 🔴 activity, multi-address, credit limit + enforcement, due-term limit, sector, indicative price, classification.
- **Action**: 🟡 extend customer + add credit-limit enforcement at sale time.

### S08 — الموردون (Supplier Card) — suppliers
- **A5G**: supplier card, supplier target, supplier agreement (اتفاق موردين), bonus-recovery account.
- **Ours**: 🟡 supplier + payable account.
- **Gaps**: 🔴 target, agreement terms, bonus recovery.
- **Action**: 🟡 extend supplier.

### S09 — المخازن (Stores) — `Stores`
- **A5G**: multiple stores, store tree, auto-create store+treasury per rep, period close (إغلاق مخازن), allow-negative toggle.
- **Ours**: ✅ warehouses + per-rep custody, per-location stock, **no-negative enforced (XI)**.
- **Gaps**: 🟡 store tree/grouping, period close. ⚠️ allow-negative is intentionally forbidden (keep).
- **Action**: 🟡 add period-close (lock movements ≤ date).

### S10 — المندوبون والمناطق (Reps & Areas) — `Emp` / areas
- **A5G**: reps, **areas/regions**, rep↔customer link, **rep targets (هدف)**, commissions, sector, per-rep price-limit.
- **Ours**: 🟡 sales_rep role + territory.
- **Gaps**: 🔴 targets, commissions, area analytics, rep price limits.
- **Action**: 🟡 add rep targets + commission rules + area reporting.

---

## PHASE 1 — Transactions (الحركات / المستندات)

### T01 — قيد اليومية (Journal Entry) — `acc` (`AccIn/AccOut`)
- **A5G**: manual journal (قيد / قيد حر), multi-line debit/credit, cost center, currency, statement (بيان), links to store/treasury, "اختصار قيد فاتورة المبيعات".
- **Ours**: ✅ immutable balanced ledger entries — but only system-posted (no manual journal UI).
- **Gap**: 🟡 manual journal-entry screen against the chart of accounts (needs S05).
- **Action**: 🔴 Spec 004 — manual journal entry on the chart of accounts.

### T02 — فاتورة المبيعات (Sales Invoice) — sales
- **A5G**: lines (item, unit/factor, qty, price-from-tier), **discounts** (allowed/earned/deferred/penalty; before/after tax; distribute over lines), **taxes** (VAT, **withholding كسب العمل**, addition tax), **payments on invoice** (نقدى/آجل + multiple payments), rep, area, cost center, points/bonus, credit-limit & due checks, export/short/daily-cash/fuel/patient variants.
- **Ours**: 🟡 sales invoice: combined-% discount (fixed+variable), split cash/credit, no VAT, points (003), rep-scope.
- **Gaps**: 🔴 price-tier selection, multi-unit, withholding & VAT, discount types, payments-on-invoice (partial), cost center, credit-limit/due enforcement, invoice variants.
- **Action**: large — staged enhancements to the 002 sales invoice.

### T03 — مردود المبيعات (Sales Return) — returns
- **A5G**: return on invoice / free return (مردود ليس بفاتورة), reverse money + points.
- **Ours**: ✅ partial returns, proportional money, points reversal (Q3 hybrid).
- **Gap**: 🟡 free return (not tied to an invoice).
- **Action**: 🟡 add free-return option.

### T04 — فاتورة المشتريات + مردود (Purchase Invoice & Return) — purchases
- **A5G**: purchase invoice, expenses-on-purchase affecting average cost, returns, last-purchase price (incl. VAT).
- **Ours**: ✅ purchase (cash/credit split, supplier payable), partial proportional returns. 🔴 no expenses-on-purchase / avg-cost (we're quantity-only).
- **Action**: 🟡 (ties to item valuation S06) — add purchase expenses + cost effect IF we adopt inventory valuation.

### T05 — أذون المخزن (Store Permits) — add / issue / transfer
- **A5G**: `اذن إضافة` (add), `اذن صرف` (issue), `اذن تحويل مخزن→مخزن`, **`اذن تحويل عدة مخازن→عدة مخازن`** (multi-store), `اذن افراج خامات` (raw release), pricing of transfer/add permits.
- **Ours**: ✅ stock movements + single-source/dest transfer (Branch-Manager approval), manufacturing consume/produce.
- **Gaps**: 🔴 **multi-store→multi-store transfer**, standalone add/issue permits (we post movements via documents only), transfer pricing.
- **Action**: 🟡 add standalone add/issue permits + multi-store transfer.

### T06 — الإنتاج (Production) — `Entg`
- **A5G**: production card (+detailed), work order (امر شغل), **auto-issue raw materials from sale invoice** (BOM), produced-cost estimate (avg / last-purchase).
- **Ours**: ✅ decoupled consume/produce (no BOM).
- **Gap**: 🟡 optional BOM + auto-issue-on-sale, produced-cost.
- **Action**: 🟡 add optional recipe/BOM (keep decoupled as default).

### T07 — الخزينة والتحصيلات (Treasury & Receipts) — treasury
- **A5G**: treasury (main + per rep/store), receipts (تحصيل), **commercial papers** (أوراق/شيكات تحت التحصيل, delay tracking), multi-currency treasury, payments.
- **Ours**: ✅ consolidated treasury + custodies, ledger-derived. 🔴 commercial papers (cheques) & collection workflow.
- **Action**: 🟡 add commercial-papers (cheques) module.

### T08 — الأمانات (Consignment) — `Amanat`
- **A5G**: consignment stock report/handling.
- **Ours**: 🔴 missing.
- **Action**: 🔴 add consignment (stock held but not owned/sold yet).

---

## PHASE 2 — Reporting (التقارير) — `*Rpt*`  (100+)
- **A5G areas**: Accounting (balances, trial balance by currency/day/month, customer balances by
  area/date, credit limits, commercial papers, account-tree analysis), Sales (orders, points/bonus,
  area, monthly), Customer/Employee (targets, per-rep analysis, 5-price lists, settlement), Stores
  (item movement, costs, consignment, limits), Purchases (orders, expiry, supplier target), Profit
  (summary, per-item), Production, HR (salaries).
- **Ours**: 🔴 minimal. **Principle IX = reporting is first-class.**
- **Action**: 🔴 Spec 005 — reporting layer (PDF/Excel), derived from the same source of truth.

---

## PHASE 3 — Deferred / Activity-specific (مؤجّل)
- 🔴 **شئون العاملين / الرواتب (HR & Payroll)** — `HumR`, `Mrtb` → constitution: **Employees domain = final phase**.
- ⚪ **السيارات/الصيانة (Fleet & maintenance)**, **الإنشاءات (Construction/rooms)**, **بنزينة (Gas station)**, **عيادة/مريض (Clinic)** — activity-specific verticals; handle after core parity (or strip per "نخصصه لنفسنا").
- ⚪ **استيراد بيانات من قاعدة أخرى (Import)** — covered by our table-by-table migration plan.

---

## Cross-cutting features to add (تظهر في شاشات كثيرة)
| Feature | Status | Note |
|---------|--------|------|
| Multiple units per item (+ معادل) | 🔴 | affects item, invoices, stock |
| 5 price tiers + slab pricing | 🔴 | item + sales |
| Taxes: VAT + withholding (كسب العمل) + addition | 🔴/⚠️ | we excluded VAT — decision |
| Discount types: allowed/earned/deferred/penalty | 🔴 | sales/purchase |
| Cost centers | 🔴 | ledger + documents |
| Credit limit + due-term enforcement | 🔴 | customer + sales |
| Serial numbers | 🔴 | item + sale/issue |
| Barcode (+ scale barcode) | 🔴 | item + POS |
| Period close (lock ≤ date) | 🔴 | stores + accounting |
| Multi-currency | ⚠️ | Principle VIII decision |
| Audit of edits/deletes | ✅ | we have immutable + audit log |

---

## Recommended build order (after this review is approved)
1. **004 — General Ledger & Chart of Accounts** (S05, T01) + **Trial Balance**. *(foundation of "real accounting")*
2. **Cost Centers** (S03) — small, unlocks GL/report dimension.
3. **Item enhancements** (S06): price tiers → units → serials → barcode → limits/expiry.
4. **Customer/credit** (S07) + **sales invoice taxes/discounts/payments** (T02).
5. **Store permits + multi-store transfer** (T05), **commercial papers** (T07), **consignment** (T08).
6. **005 — Reporting layer** (Phase 2).
7. **Constitution decisions** (parallel): multi-currency, granular permissions, multi-company, VAT.
8. **Deferred**: Payroll/HR; activity verticals.

> Process: we take each **S/T item** as a unit → write/adjust its spec → implement → test → tick it
> here. We modify our system **screen by screen** until full A5Group parity, then customize.
