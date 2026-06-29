# A5Group Accounting System — Complete System Map (تصوّر كامل)

> **Purpose**: A full inventory of the legacy **A5Group Accounting System** (the system we are
> replacing) — every module, screen, document, table, report, and business rule — extracted
> statically from `A5Group_Acc.exe` (VB6) and its UI strings. Used as a **requirements + migration
> reference only**. Per Constitution **Principle I (Greenfield)** we copy **no code**; we rebuild the
> logic cleanly. Per **Principle II** all clients (incl. our desktop app) consume our own OpenAPI.

**Extraction basis**: `G:\A5Group_Acc.exe` (1.47 MB, VB6, 2014) — 5,430 unique ASCII strings +
3,879 Arabic (CP1256) UI strings decoded. The live `.A5G` database was not available on this machine
(OneDrive path was a stale MRU entry), so table/field details come from the binary's embedded SQL and
identifiers, cross-checked with the prior string-dump analysis.

---

## 1. Technology (legacy)

| Aspect | Value |
|--------|-------|
| Language | Visual Basic 6.0 (32-bit), ANSI/CP1256 strings (Arabic) |
| Database | Microsoft **Jet 3.5 (Access .mdb)** renamed to **`.A5G`**; optional upgrade to SQL Server |
| Data access | ADO (`Adodc`) |
| Reports | **Crystal Reports** (`CRYSTL32.OCX`, `CRPE32.DLL`) — 100+ `.rpt` files in `ALL_RPT\` |
| Export | Excel (`U2FXLS.DLL`), HTML (`U2FHTML.DLL`), PDF (`U2FREC.DLL`) |
| Extras | Barcode (`BARCODEX.OCX`), Charts (`MSCHRT20.OCX`), TWAIN scanner (`DynamicTwainCtrl.dll`) |
| Config files | `OpnDb.cmp` (open DB), `LstDb.cmp` (DB list), `DfOption.Cmp` (option bits) |
| Licensing | per-machine (`Your_Comp`, `Win32_Processor`), expiry (`MySrvDate`) |

**Key realization**: A5Group is a **configurable multi-activity ERP**. The same engine runs as a
general trading system, a **gas station** (`فاتورة بنزينة`), a **clinic** (`فاتورة مريض`), a
**fleet/maintenance** shop (`ادارة سيارات`, `امر صيانة`), and a **contracting/construction** firm
(`ادارة انشاءات`, `انشاء غرف`). Behaviour is driven by ~350 option/permission flags.

---

## 2. Module / Department map (الإدارات)

Internal section codes end in `Depart`. The eleven departments:

| Code | الإدارة | Scope |
|------|---------|-------|
| `accDepart` | إدارة الحسابات | General ledger, chart of accounts, journals, treasury, commercial papers, currencies |
| `OrdDePart` | إدارة المبيعات | Sales invoices, quotations, returns, customers, reps, areas, points/bonus, price tiers |
| `PoordDepart` | إدارة المشتريات | Purchase invoices, returns, suppliers, purchase orders |
| `StoreDepart` | إدارة المخازن | Add/issue/transfer permits, item card, item tree, stock movement, serials |
| `EntagDepart` | إدارة الإنتاج | Production cards, work orders, raw-material release |
| `HumRDepart` | إدارة شئون العاملين | Employees, payroll (Mrtb), work hours, departments |
| `CarDepart` | إدارة السيارات | Vehicles, maintenance orders |
| `accDepart`/انشاءات | إدارة الإنشاءات | Construction/contracting, rooms |
| `ImportDepart` | إدارة الاستيراد | Import data from another DB, import invoices |
| `SetDepart` | الإعدادات والصلاحيات | Company definition, currencies setup, users & ~350 permissions |
| `OthrDepart` | إدارة أخرى | Misc |

---

## 3. Screens & documents per department

### 3.1 إدارة الحسابات (Accounting)
- **Screens**: شجرة الحسابات التحليلية، دليل الحسابات (الحسابات الرئيسية / الفرعية / الافتتاحية)،
  الخزينة (الخزينة الرئيسية)، تبديل عملة فى حساب، اعداد عملات / أسعار العملات.
- **Documents**: `قيد` (journal entry), `قيد حر` (free/manual entry), `تحصيل` / `تحصيل اوراق`
  (receipts / commercial-paper collection), مصروفات على فاتورة الشراء.
- **Concepts**: hierarchical chart of accounts (main→sub), opening balances, multi-currency with
  conversion rate, debit/credit via `AccIn`/`AccOut`, commercial papers (أوراق تجارية) with delay
  tracking.

### 3.2 إدارة المبيعات (Sales)
- **Screens**: العملاء، المندوبين (ارتباط المندوب بالعميل، افتراضى مندوب العميل)، المناطق،
  نقاط العملاء/البوانص، شرائح الأسعار، اداء مندوب.
- **Documents**: `فاتورة بيع`، `فاتورة تصدير`، `فاتورة مختصرة`، `فاتورة يومية نقدى`، `عرض سعر`،
  `مردود بيع` / `مردودات المبيعات` / `مردود على الفاتورة`.
- **Price tiers (per item, 5 levels)**: تجارى، نصف تجارى، جملة، نصف جملة، مستهلك — with options
  "السماح بالبيع اقل من …" per tier and "البيع حسب الشرائح" (slab pricing). Report `SMEmpPrc12345`.

### 3.3 إدارة المشتريات (Purchases)
- **Screens**: الموردون، أوامر الشراء، حدود/صلاحية الأصناف، هدف المورد.
- **Documents**: `فاتورة شراء`، `مردود شراء` / `مردودات المشتريات`, expenses-on-purchase affecting
  average cost.

### 3.4 إدارة المخازن (Stores)
- **Screens**: كارت الصنف، شجرة الاصناف، حركة المخازن، حدود الأصناف، الأمانات (consignment),
  السيريال (بحث عن سيريال نمبر، سيريال يدوى)، باركود ميزان (scale barcode prefix).
- **Documents**: `اذن إضافة` (add permit), `اذن صرف` (issue permit), `اذن تحويل من مخزن الى مخزن`,
  `اذن تحويل من عدة مخازن الى عدة مخازن`, `اذن افراج خامات` (raw-material release), `اذن صرف للتحويل`.
- **Options**: السماح بالرصيد السالب للمخزن (allow negative stock — note: our system FORBIDS this,
  Principle XI), أغلاق مخازن (period close), average-cost valuation.

### 3.5 إدارة الإنتاج (Production)
- **Screens**: كارت انتاج، كارت انتاج تفصيلى.
- **Documents**: `امر شغل` (work order), `اذن افراج خامات`.
- **Logic**: صرف تلقائى للخامات من فاتورة البيع (auto-issue raw materials on sale) — i.e. recipe/BOM
  capable (richer than our decoupled, BOM-free model).

### 3.6 إدارة شئون العاملين (HR / Payroll)
- **Screens**: الموظفين، الأقسام (`HumRDepart`)، ساعات العمل، اضافى ساعات عمل.
- **Reports/tables**: `HumR5_EmpSlfMrtb`, `HumR8_Mrtb`, `HumR9_EmpMrtbRpt` (payroll/salaries).

### 3.7 إدارة السيارات (Fleet) & الإنشاءات (Construction)
- Fleet: انشاء السيارات، `امر صيانة` (maintenance order).
- Construction: ادارة انشاءات، انشاء غرف (rooms), انشاءات فقط (mode flag).

### 3.8 الإعدادات والصلاحيات (Settings)
- تعريف المنشأة (company/establishment definition), اعداد عملات, اعدادات وصلاحيات مستخدمين.

---

## 4. Data tables (from binary identifiers / SQL)

| Table | الوصف |
|-------|-------|
| `acc` | journal lines — `acc_id, acc_Date, AccIn, AccOut, accMain_id, AccBrnch_id, AccBrnch_n, accMain_n, accName, AccClose, AccEx_id, AccPort_id` |
| `acc_main` | chart-of-accounts main accounts — `accName, AccMain_id` |
| `accBrnch` | sub-accounts (analytical) |
| `accAdd`, `accDepart`, `accMezan` | account additions, sections, trial-balance views |
| `mzan` | trial balance / balances |
| `CurTyps`, `CurN`, `CurPrc` | currency types, names, rates (multi-currency) |
| `Cust` | customers — `Cust_id, Cust_name, Wk` (Wk=active flag) |
| `Emp`, `EmpRep` | employees / sales reps — `Emp_id, Emp_name, Emp_Job` |
| `Stores`, `Store`, `StoreMov`, `StoreDepart` | stores & stock movement |
| `Ord`, `OrdDePart` | orders/sales |
| `Cats`, `Item`/item tables | categories, items (5 price tiers, serial, barcode) |
| `Your_Err` | users & permissions — `NNN, User_n, Your_Name, Pass_1, Pass_2, Boss, Err_1, ChatRom` (⚠ plaintext passwords) |
| `Your_Comp`, `Win32_Processor`, `MySrvDate` | licensing |
| `Cmp_Brn` | companies & branches (multi-company) |
| `acc_Opt`, `opt1`, `BtmFn`, `MsgNor`, `Cats`, `DpPaths`, `Reop/Repo/RepoH` | options, buttons, messages, db paths, saved reports |

---

## 5. Reports (Crystal) — 100+ codes by area

- **Accounting** (`AccRpt0..28`, `AccMezan*`): general, safe/treasury, balance summaries, customer
  balances by area/date, supplier report, time-aged balances, credit limits, commercial papers,
  account-tree analysis, daily analysis, trial balance by currency/day/month.
- **Sales** (`OrdRpts*`): order summaries/details, min-sale, **customer points & bonus**
  (`OrdRpts7_CustPointBons`), area sales, monthly summary.
- **Area** (`OrdRptsArea*`), **Customer** (`OrdRptsCst*`), **Employee** (`OrdRptsEmp*` — targets,
  per-rep analysis, 5-price lists, orders & settlement).
- **Stores** (`StoreRpt*`): store tree, by-supplier, inventory-to-date, item movement, item summary,
  costs, consignment (`Amanat`), item limits.
- **Purchases** (`PoordRPts*`): purchase orders, item limits/expiry, supplier target.
- **Profit** (`ArbahRpts*`): profit summary, per-item profit.
- **Production** (`Entg*`): production & process reports.
- **HR** (`HumR*`): employee salaries.

---

## 6. Permission / option model (~350 flags)

Stored as checkbox arrays `ChkUsr2(0..202)`, `ChkUsrN(0..99)`, `ChkV4(0..49)`. Representative flags
(from UI strings):
- **Selling limits**: السماح بالبيع اقل من التجارى / الجملة / نصف التجارى / نصف الجملة / الشراء؛
  عدم السماح باعلى من المستهلك؛ البيع حسب الشرائح اجبارى للعميل المستهلك.
- **Stock**: السماح بالرصيد السالب للمخزن؛ السماح بتكرار الصنف؛ السماح بالسيريال اليدوى.
- **Edit/delete**: السماح بالتعديل / الحذف / الحذف والتعديل؛ السماح بتعديل قيود مرتبطة بحركة مخزنية؛
  السماح لغير مدير البرنامج بتعديل وحذف قيود مخازن؛ الاحتفاظ بسجل للتعديلات والمحذوفات (audit).
- **Prompts (السؤال عن …)**: المخزن، البيان، القيد الضريبى، مندوب البيع، مدير المبيعات، العملة، …
- **Defaults (افتراضى …)**: مندوب العميل، سعر الصنف، كود الحساب/الصنف بالشرطة المائلة.

> This is far more granular than our 6-role + capability RBAC (**Principle VII**). Adopting per-user
> 350-flag permissions would be a **major RBAC change** — needs a constitution decision.

---

## 7. Mapping to our system (techno) — built / gap / conflict / deferred

| A5Group capability | Our status |
|--------------------|------------|
| Customers + moving balances | ✅ Foundation (001), ledger-derived |
| Suppliers + purchase orders/invoices/returns | ✅ Sales & Inventory (002) |
| Stores + item movement + transfers (incl. multi-store) | ✅ 002 (single-store transfers; **multi-store transfer** is a gap) |
| Manufacturing | ✅ 002 (decoupled) — A5G also has **BOM/auto-issue from sale** (gap) |
| Customer points & bonus / coupons | ✅ After-Sales (003) |
| Immutable journal (debit/credit) | ✅ 001 ledger |
| **Hierarchical Chart of Accounts** (acc_main/accBrnch) | 🟢 **GAP** — biggest; our ledger uses fixed account types, not a user-defined GL |
| **Trial balance** (mzan) + accounting reports | 🟢 GAP — reporting layer minimal |
| **Sales reps targets / area analysis** | 🟢 GAP (reps exist; targets/areas don't) |
| **5 price tiers per item** (تجارى/جملة/مستهلك/…) | 🟢 GAP — our product has one fixed sale price |
| **Commercial papers** (أوراق تجارية / تحصيل اوراق) | 🟢 GAP |
| **Consignment (الأمانات)** | 🟢 GAP |
| **Serial numbers per item** | 🟢 GAP |
| **Multi-currency** (CurTyps/CurPrc) | 🟡 **CONFLICT** — Principle VIII = EGP only (needs amendment) |
| **~350 granular per-user permissions** | 🟡 CONFLICT — Principle VII = role-based |
| **Multi-company** (Cmp_Brn) | 🟡 CONFLICT — our scope = one company + branches |
| **Negative stock allowed** (option) | 🟡 CONFLICT — Principle XI forbids negative stock (intentional) |
| Payroll / HR (HumR, Mrtb) | ⚪ DEFERRED — Employees domain (constitution: final phase) |
| Vehicles/maintenance, Construction, gas-station, clinic | ⚪ Out of scope (activity-specific verticals) |
| Crystal Reports | ✅ replaced by server-generated PDF/Excel |
| Plaintext passwords (Pass_1/Pass_2) | ✅ we use bcrypt; **do not migrate passwords** — force reset |

---

## 8. Recommended new specs (to reach parity)

1. **`004` General Ledger & Chart of Accounts** — hierarchical chart (main→sub), manual journal
   entries, trial balance; built additively on the Foundation ledger (our fixed accounts become nodes).
2. **`005` Reporting** — accounting / sales / stores / profit reports from the same source of truth
   (Principle IX), exported as PDF/Excel.
3. **Sales enhancements** — multi-tier item pricing, sales-rep targets & area analysis, commercial
   papers, consignment, item serials (each a focused spec).
4. **Constitution decisions first** (block before building): multi-currency? per-user granular
   permissions? multi-company? — each needs an amendment if adopted.
5. **Deferred**: Payroll/HR (final phase).

---

*Generated 2026-06-28 from static analysis of A5Group_Acc.exe. No legacy code reused (Principle I);
this document informs greenfield specs and the eventual table-by-table data migration.*
