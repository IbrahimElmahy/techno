# 031 — Accounting reports the Odoo way (dashboard · P&L · balance sheet · trial balance · general ledger)

> Status: proposal (read-only research, 2026-10-14). Nothing in the code was changed.
> Relation to existing work: `specs/032-odoo-accounting/plan.md` already delivered the Odoo
> **bookkeeping** model (journals + numbering, `account.move` fields on `ledger_entry`, partner on
> every line, reconciliation, lock dates, hash chain, partner ledger, cash flow, analytic
> distribution). This spec is the missing **reporting** layer on top of it. It reuses everything
> from 032 and does not reopen it. (Folder number `031` was requested; `031-a5-restructure` and
> `032-odoo-accounting` already exist — consider moving this file to `032-odoo-accounting/spec.md`.)

## 1. How Odoo does it (summary)

> Note: the web research pass hadn't finished when this file was written. The points below
> come from Odoo 17/18 behaviour as documented, and **every link still needs checking** before
> anyone quotes it to the client. Main entry points:
> https://www.odoo.com/documentation/17.0/applications/finance/accounting/reporting.html ·
> https://www.odoo.com/documentation/17.0/applications/finance/accounting/get_started/chart_of_accounts.html ·
> https://www.odoo.com/documentation/17.0/applications/finance/accounting/reporting/year_end.html ·
> https://www.odoo.com/documentation/17.0/applications/general/companies.html ·
> https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/product_management/inventory_valuation/inventory_valuation_config.html ·
> source: https://github.com/odoo/odoo/blob/17.0/addons/account/models/account_account.py (account_type selection).

* **Dashboard**: kanban of one card per journal. Sales/purchase cards show drafts to validate,
  late invoices/bills (count and amount) and a bar chart by due week. Bank/cash cards show the
  balance in the GL, a 30-day line chart and items to reconcile. Misc cards show drafts. Each card
  has a primary action (New invoice / Upload / New entry) and a ⋮ menu (lists, reports, config).
* **Report engine** (`account.report` → lines → expressions with engines: domain, aggregation,
  account_codes, tax_tags, external, custom). Every financial report is computed from **posted
  journal items** (drafts are optional), never from documents. Common options: date presets
  (month / quarter / fiscal year / custom; BS uses "as of"), comparison (previous period or same
  period last year, ×N), journals, analytic, partners, posted/draft, multi-company, unfold all,
  hierarchy (account groups by code prefix), and PDF/XLSX export. Clicking any amount opens the
  General Ledger or Journal Items behind it; from 17 an «Audit» action does the same. Annotations
  and budgets are Enterprise extras.
* **P&L** generic lines: Revenue · Less Costs of Revenue · Gross Profit · Less Operating Expenses
  · Operating Income · Plus Other Income · Less Other Expenses · Net Profit. These map to the
  account types `income`, `expense_direct_cost`, `expense`, `income_other` and
  `expense_depreciation`. Each line unfolds into its accounts.
* **Account types** (17/18): asset_receivable, asset_cash, asset_current, asset_non_current,
  asset_prepayments, asset_fixed, liability_payable, liability_credit_card, liability_current,
  liability_non_current, equity, equity_unaffected, income, income_other, expense,
  expense_depreciation, expense_direct_cost, off_balance.
* **Cost of revenue / stock**: with *periodic (manual)* valuation, bills post to expense and
  stock is adjusted with periodic entries. With *perpetual (automated)* valuation, stock moves post
  valuation entries. The Anglo-Saxon option posts COGS at invoicing and sends it to the
  expense_direct_cost account.
* **Trial balance**: Initial balance, then the period (and any comparison periods), then End
  balance, each split Debit/Credit, grouped by account. P&L accounts restart at the start of the
  fiscal year. Prior years' results show on the "Undistributed Profits/Losses" line
  (`equity_unaffected`, 999999) **without any closing entry**. The Balance Sheet splits equity
  into Current Year Earnings, Previous Years Unallocated Earnings and Retained Earnings.
* **Year end**: there is no mandatory closing entry. Lock dates do the job instead (17: period
  lock and fiscal-year lock; 18 adds a hard lock date).
* **Multi-company / branches (17+)**: branches are child companies. When several companies are
  selected, the reports simply **add up** their journal items. Elimination is not part of the
  standard reports. It belongs to the Enterprise **Consolidation** app: a consolidation chart,
  company mapping, and elimination journals/entries kept outside the companies' books. Its
  standing in 18 still needs checking.

## 2. Inter-branch sales — Odoo's logic and our recommendation

### 2.1 Odoo's logic for inter-branch sales

1. Inside **one company**, moving goods between warehouses is an **internal transfer** (a stock
   picking). No invoice, no revenue, so nothing is double-counted. That is Odoo's recommended
   pattern.
2. Between **separate companies or branches**, inter-company rules mirror the documents (a sale in
   A creates a purchase in B). Each book is complete for its own entity.
3. When the user selects the parent plus its branches, the standard P&L/BS **sum the books as
   they are**, so inter-branch revenue and purchases both appear. Removing them is a
   **consolidation step**: elimination entries in a separate consolidation layer, shown as an
   elimination column next to the company columns, with the consolidated total last. The
   companies' own books are never changed.

### 2.2 What this means for us

* Our three branches are one legal entity, and stock transfers (`transfer_service`) already post
  no ledger entry. That is Odoo point 1. **From now on, goods moved between branches should go
  through «تحويل مخزني», not through sales/purchase invoices to the «داخلي» cards.**
* The history imported from a5 contains real inter-branch invoices (customers/suppliers with type
  `internal`). We can't rewrite them because the legacy data is read-only and we prefer not to
  edit migrated history. So we do what Odoo point 3 does: standard reports keep summing, and a
  consolidated view adds an **eliminations column**.

### 2.3 Elimination rule (computed, never posted)

When «كل الفروع» is selected with «استبعاد المعاملات بين الفروع»:
* **P&L**: subtract every P&L line (revenue, returns, discounts, purchases) of entries whose
  partner (`ledger_line.partner_kind/partner_id`, inherited from the entry) is a customer or
  supplier of type `internal`. If the sales side and the purchase side don't cancel, show the
  remainder on its own line «فرق مطابقة بين الفروع». Never hide it.
* **BS / TB**: subtract the receivable/payable balances of the internal parties in the same way.
* **Unrealized margin in closing stock**: Odoo leaves this as a manual consolidation entry, and so
  do we (P3).
* The management view keeps its existing `consolidation.eliminate_internal` toggle (same rule
  applied to documents).
* Default is **off**, as in Odoo's standard reports. The option and the per-branch columns make
  the double counting visible and removable in one click.

---

## 3. Gap table

Legend — priority: **P1** must (the user's request cannot be called done without it), **P2** should,
**P3** later. Size: **XS** < ½ day · **S** ≈ 1 day · **M** 2–4 days · **L** 1–2 weeks.

### 3.1 Foundations (shared by every report)

| Odoo feature | What we have | What to build | Pri | Size |
|---|---|---|---|---|
| `account_type` on every account drives every report line | `Account.account_type` (9 *system* roles: treasury, customer_receivable…; almost every real account is `user_defined`), `nature` (5 values), `appears_in` (a5's trading / profit_loss / balance_sheet / none), and the income sheet's per-account **role** stored in JSON config (`income_statement_setting.config.accounts.roles`) | New column `account.report_type` with Odoo's 18 values, inherited down the parent tree like `effective_nature`; backfill script; dropdown in the chart screens (§5.1) | P1 | M |
| One options bar for all reports: date presets, comparison, journals, branches, analytic, draft toggle, hide zero, hierarchy, unfold all | Each page has its own filters. `report_options.py` supports one comparison (previous / last year) and posted-only; TB has date + one branch + cost center; income sheet has its own period selector (N trailing periods) | Backend: extend `ReportOptions` (§4.0). Frontend: one `<AccountingReportOptions>` component reused by P&L, BS, TB, GL, partner ledger, aging; options kept in the URL so a report link is shareable | P1 | M |
| Fiscal year (P&L accounts restart at FY start; prior years roll into "Undistributed Profits/Losses" without a closing entry) | None. TB opening of income/expense accounts = everything since the start of history. BS shows all-time profit as «أرباح الفترة الحالية» | `accounting_setting.fiscal_year_last_month` / `last_day` (default 12/31) + a system equity account «أرباح وخسائر غير موزعة» (`equity_unaffected`). Computed in SQL, no posting (§5.3) | P1 | S |
| Multi-branch selector (several companies/branches → amounts are **summed**) | One branch or «كل الفروع» (`branch_sql`) | Multi-select `branch_ids`; optional **column per branch** (`group_by=branch`) — one `GROUP BY account_id, branch_id` query | P1 | S |
| Drill-down: amount → general ledger / journal items → entry → source document | TB leaf → `/account-statement?account=…` (per-account statement, good). Income sheet: modal per section. BS: none | Every amount cell opens a menu: «دفتر الأستاذ العام» · «بنود القيود» · (P3) «تدقيق». All pass account ids + period + branch + journals | P1 | S |
| Export PDF + XLSX | Print (HTML → PDF) on TB and income sheet; `utils/exportExcel.ts` exists but is not used by the accounting reports | «PDF» uses the existing `printDocument`; «Excel» uses `exportExcel.ts` on the same row model the screen renders (what you see is what you export, incl. folding) | P2 | S |
| Annotations, «Audit» per cell, budgets column | None | Later | P3 | M |

### 3.2 Accounting dashboard («لوحة المحاسبة»)

| Odoo feature | What we have | What to build | Pri | Size |
|---|---|---|---|---|
| A card per journal, by journal type, with a primary action | ✅ `AccountingDashboard.tsx` + `accounting_dashboard_service`: a card per journal (code, name, hash lock, month total, entries, open residual, drafts, last entry) + treasury cards | Keep; adapt content per type (below) | — | — |
| Sales card: drafts to validate, **late invoices (count + amount)**, bar chart of invoiced amounts per week (past · this week · future due) | Month total + open residual only | Add `late_count/late_amount` (posted out_invoice with `payment_state != paid` and `invoice_date_due < today`), `to_validate` (drafts), `weekly` (5 buckets) — one grouped SQL each | P2 | S |
| Purchase card: bills to pay / late, same chart | Same as above | Same for in_invoice | P2 | S |
| Bank / cash card: balance in GL, 30-day balance line chart, «X to reconcile», New transaction / Reconcile | Separate treasury cards (balance only) | Merge treasury into the cash/bank journal card: GL balance + 30-day sparkline (one query: daily net movement + opening). «To reconcile» needs bank statements → P3 | P2 | S |
| Misc journal: drafts, new entry | ✅ drafts + «قيود الدفتر» | — | — | — |
| Shortcut to reports | Button «التقارير المالية» → `/finance-reports?tab=income` (**broken**: that tab no longer exists) | Point it to `/income-sheet`; add «الميزانية» and «ميزان المراجعة» | P1 | XS |

### 3.3 Profit and Loss («قائمة الدخل»)

| Odoo feature | What we have | What to build | Pri | Size |
|---|---|---|---|---|
| P&L **computed only from posted journal items**, lines defined by account type | Two P&Ls: (a) `financial_reports_service.income_statement` — flat income / expense list by nature, no UI any more; (b) `income_statement_service` (the «قائمة الدخل» page) — a **management** statement: sales from invoices classified into categories, COGS computed outside the ledger (periodic or frozen-cost "perpetual"), expense roles from JSON config, coupon marketing model, manual «زيادة» items, inventory overrides, and a bridge to the ledger net profit | New `pl_report_service.build(options)` with the Odoo layout (§4.2) from the ledger. The current page keeps its statement as a second view «العرض الإداري» (renamed «قائمة الدخل الإدارية»), unchanged in logic | P1 | M |
| Lines: Revenue · Less Cost of Revenue · **Gross Profit** · Less Operating Expenses · **Operating Income** · Plus Other Income · Less Other Expenses (depreciation) · **Net Profit** | Same names exist in the management view but with our own sections (G&A / marketing / other losses / manufacturing roles) | Lines driven by `report_type` (§4.2). Sub-lines unfold to the account tree (our `parent_id` tree = Odoo account groups) | P1 | (in above) |
| Cost of Revenue includes stock valuation (COGS) | The ledger has **no COGS and no inventory movement**: purchases are expensed to «المشتريات», sales post revenue only. So a pure ledger P&L today = sales − purchases − expenses, without the inventory change | Odoo *periodic* valuation: a system-generated period-end entry «قيد تقييم المخزون» (§5.4). Until it is posted the P&L shows a warning row «لم يُرحَّل قيد تقييم المخزون لهذه الفترة» with the computed amount | P1 | M |
| Comparison: previous period ×N, same period last year ×N, with growth % | Management view: N trailing periods (month / quarter / year) + one compare range | Options bar comparison (shared). Columns: each period + «التغير %» (only when exactly 2 columns, as Odoo) | P1 | S |
| Branch selector (sum) + Consolidation-style eliminations | `eliminate_internal` (opt-in, management view only, hides sales to internal customers / purchases from internal suppliers) | §2 — column per branch + «استبعادات بين الفروع» column + «المجمّع» | P1 | M |
| Analytic filter | Cost center filter on TB only; profitability page by cost center | Pass `cost_center_ids` through `analytic_service.shares_of` (already the single gate) | P2 | S |
| Draft entries toggle | `posted_only` param | Options bar «تضمين المسودات» | P1 | XS |

### 3.4 Balance sheet («الميزانية»)

| Odoo feature | What we have | What to build | Pri | Size |
|---|---|---|---|---|
| Layout: Current assets (Bank and cash · Receivables · Current assets · Prepayments) + Fixed assets + Non-current assets = Total assets; Current liabilities (Current liabilities · Payables) + Non-current liabilities; Equity: Unallocated earnings (current year + previous years) + Retained earnings; Liabilities + Equity | `balance_sheet_tree`: three trees by `nature` + «أرباح الفترة الحالية» = **all-time** income − expense | `bs_report_service` driven by `report_type`; current-year earnings from FY start; previous-years unallocated = P&L before FY start + balance of `equity_unaffected` account | P1 | M |
| "As of" date + comparison | ✅ as-of + one comparison | Shared options bar | P1 | XS |
| Per-customer accounts would make thousands of lines | Each customer/supplier has its own sub-account (Odoo has **one** receivable account and the partner on the line) | Receivables/payables lines show the group total; unfold lazily (`?parent_id=`, top 200 by balance + «عرض الكل في دفتر الشريك») | P1 | S |
| Inter-branch receivable / payable eliminated in consolidation | None (balances of «داخلي» parties stay in assets and liabilities) | Same elimination column as P&L (§2.3) | P2 | S |

### 3.5 Trial balance («ميزان المراجعة»)

| Odoo feature | What we have | What to build | Pri | Size |
|---|---|---|---|---|
| Columns: Initial balance · (comparison periods) · Period · End balance, each Debit/Credit | ✅ `trial_balance_tree`: opening Dr/Cr, period Dr/Cr, closing Dr/Cr, account tree, search, expand/collapse, branch + cost center filters, integrity warnings (unbalanced entries, postings on group accounts), print | Keep the screen; switch it to the shared options bar | — | — |
| P&L accounts' initial balance resets at FY start; a synthetic line «Undistributed Profits/Losses» carries prior years so the TB still balances | Opening of P&L accounts = all history | `trial_balance_tree(fy_aware=True)`: for income/expense report types, `opening` counts only lines with `date >= fy_start(from)`; the excluded amount goes to the `equity_unaffected` row (§5.3). Totals unchanged → still balanced | P1 | S |
| Comparison columns (N periods) | None | `periods[]` → one query with `_bucket` (pattern already in `income_statement_service`) | P2 | S |
| Journal filter, draft toggle, hide zero | None | Options bar | P1 | XS |
| Hierarchy by account groups / "Hierarchy and subtotals" | ✅ parent tree | Lazy children for groups with > 200 leaves (customers/suppliers) | P1 | S |
| XLSX | Print only | Options bar «Excel» | P2 | XS |

### 3.6 General ledger («دفتر الأستاذ العام») and drill-down

| Odoo feature | What we have | What to build | Pri | Size |
|---|---|---|---|---|
| One report, all accounts with movement, each foldable: initial balance row, journal items (date, entry, communication, partner, debit, credit, running balance), total row; paging "load more" | `AccountStatement.tsx` (1.5k lines): statement of **one** account or an account group, rich (grouping by month/type/sub-account, item card). `JournalTab` lists entries. No all-accounts GL | New tab `/general-ledger?tab=gl`: top level = account rows with initial / debit / credit / end (same SQL as TB); unfolding an account calls `GET /api/v1/reports/general-ledger/lines?account_id=…&offset=…&limit=200` (SQL window `SUM() OVER` for the running balance, offset paging) | P1 | M |
| Click a journal item → entry → source document | `JournalTab` opens an entry by `?entry=`; entries know their document | Row click → entry modal (existing) → «فتح المستند» | P1 | XS |
| Partner ledger | ✅ (032 phase 4) | Options bar only | P2 | XS |
| Aged receivable/payable buckets: At date · 1–30 · 31–60 · 61–90 · 91–120 · Older, by due date | ✅ by due date with residuals; buckets 0-30 · 31-60 · 61-90 · 90+ | Add «غير مستحق» (not yet due) and 91–120 / «أقدم»; keep by-due-date | P2 | XS |
| Cash flow statement | ✅ `cash_flow_service` + `CashFlowTab.tsx`, but the tab is **not listed** in `FinanceReports` `TABS` (unreachable) | Add the tab + nav entry «قائمة التدفقات النقدية». Classify by account tag (§5.2) instead of name heuristics | P2 | S |
| Executive summary | None | Later | P3 | S |

---

## 4. Report definitions (what each backend service returns)

### 4.0 Shared options (`report_options.py` extended)

```python
@dataclass(frozen=True)
class ReportOptions:
    date_from: date | None          # None for "as of" reports (BS)
    date_to: date
    preset: str | None              # this_month|this_quarter|this_fy|last_month|last_quarter|last_fy|custom
    comparison: str = "none"        # none|previous|last_year
    comparison_count: int = 1       # 1..12 (Odoo: "Number of periods")
    branch_ids: tuple[int, ...] = ()   # () = all
    split_by_branch: bool = False   # one column per branch
    eliminate_inter_branch: bool = False  # adds the eliminations column (§2.3)
    journal_ids: tuple[int, ...] = ()
    cost_center_ids: tuple[int, ...] = ()
    posted_only: bool = True        # «تضمين المسودات» = False
    hide_zero: bool = True
    hierarchy: bool = True
```

Every report = **one** aggregate query `SELECT bucket, branch_id, account_id, SUM(debit), SUM(credit)
… GROUP BY …` (buckets via the existing `_bucket()` CASE pattern), then a Python roll-up over the
account tree (a few thousand rows at most). No per-line Python loops over journal items — the
production server is one worker / 2 GB.

### 4.1 Line engine (a small subset of Odoo's `account.report`)

```python
PL_LINES = [
  Line("revenue",   "الإيرادات",                types={"income"},              sign=-1),
  Line("cor",       "يُطرح: تكلفة الإيرادات",     types={"expense_direct_cost"}, sign=+1),
  Total("gross",    "مجمل الربح",               "revenue - cor"),
  Line("opex",      "يُطرح: المصروفات التشغيلية",  types={"expense"},             sign=+1),
  Total("op",       "الربح التشغيلي",            "gross - opex"),
  Line("oi",        "يُضاف: إيرادات أخرى",        types={"income_other"},        sign=-1),
  Line("oe",        "يُطرح: مصروفات أخرى",        types={"expense_depreciation"}, sign=+1),
  Total("net",      "صافي الربح",                "op + oi - oe"),
]
```

A `Line` unfolds into the account tree of the accounts it selected (hierarchy on) or a flat list by
code (hierarchy off). Contra accounts (sales returns, allowed discount) sit inside Revenue with
their natural debit sign, exactly as Odoo shows them (negative inside the revenue block).

### 4.2 P&L — `pl_report_service.build(db, options) -> dict`

Returns `{columns: [...], lines: [{id, label, level, kind: section|account|group|total,
account_id?, values: [Decimal per column], unfoldable}], warnings: [...]}`. Warnings:
`inventory_valuation_missing` (no posted valuation entry for a month in range — shows the computed
amount from `inventory_valuation_service.values_at`), `unclassified_accounts` (accounts with
movement and no effective `report_type`, listed with a link to the chart).

### 4.3 Balance sheet — `bs_report_service.build(db, options)`

| Line | Arabic label | Source |
|---|---|---|
| ASSETS | الأصول | — |
| Current assets | الأصول المتداولة | — |
| Bank and cash | النقدية والبنوك | `asset_cash` |
| Receivables | الذمم المدينة | `asset_receivable` |
| Current assets | أصول متداولة أخرى | `asset_current` |
| Prepayments | مصروفات مدفوعة مقدمًا | `asset_prepayments` |
| Plus fixed assets | يُضاف: الأصول الثابتة | `asset_fixed` |
| Plus non-current assets | يُضاف: الأصول غير المتداولة | `asset_non_current` |
| Total assets | إجمالي الأصول | sum |
| LIABILITIES | الالتزامات | — |
| Current liabilities | الالتزامات المتداولة | `liability_current` + `liability_credit_card` |
| Payables | الذمم الدائنة | `liability_payable` |
| Plus non-current liabilities | يُضاف: الالتزامات غير المتداولة | `liability_non_current` |
| EQUITY | حقوق الملكية | — |
| Unallocated earnings | الأرباح غير الموزعة | — |
| · Current year earnings | أرباح العام الحالي | P&L types from FY start to `date_to` |
| · Previous years unallocated earnings | أرباح سنوات سابقة غير موزعة | P&L types before FY start + `equity_unaffected` balance |
| Retained earnings / capital | رأس المال والأرباح المحتجزة | `equity` |
| Liabilities + equity | إجمالي الالتزامات وحقوق الملكية | sum |
| (check) | فرق التوازن | must be 0, red banner otherwise |

### 4.4 Trial balance — `trial_balance_tree(options, fy_aware=True)`

Columns: «الرصيد الافتتاحي» (مدين · دائن) · [each comparison period (مدين · دائن)] · «حركة الفترة»
(مدين · دائن) · «رصيد آخر المدة» (مدين · دائن). Extra synthetic row «أرباح وخسائر غير موزعة» when
`fy_aware` moves prior-years P&L out of the income/expense openings. Totals must still balance;
the existing integrity checks stay.

### 4.5 General ledger — `gl_report_service`

* `summary(options)` → per account: initial, debit, credit, end (reuses TB SQL).
* `lines(options, account_id, offset, limit=200)` → journal items with `SUM(signed) OVER (ORDER BY
  date, entry_id, line_id)` + the initial balance added; total count for «تحميل المزيد».

---

## 5. Data model changes

### 5.1 `account.report_type` (Odoo `account_type`)

New nullable `String(24)` column `report_type` on `account`, plus `effective_report_type(acc)`
= own value, else the nearest ancestor's, else a default from `account_type` / `nature`. Validated
against `nature` (an `asset_*` type on a liability account is refused).

| Odoo value | Arabic label (dropdown «نوع الحساب في التقارير») | nature |
|---|---|---|
| `asset_receivable` | ذمم مدينة | asset |
| `asset_cash` | نقدية وبنوك | asset |
| `asset_current` | أصول متداولة | asset |
| `asset_non_current` | أصول غير متداولة | asset |
| `asset_prepayments` | مصروفات مدفوعة مقدمًا | asset |
| `asset_fixed` | أصول ثابتة | asset |
| `liability_payable` | ذمم دائنة | liability |
| `liability_credit_card` | بطاقات ائتمان | liability |
| `liability_current` | التزامات متداولة | liability |
| `liability_non_current` | التزامات غير متداولة | liability |
| `equity` | حقوق الملكية | equity |
| `equity_unaffected` | أرباح العام الحالي (غير موزعة) | equity |
| `income` | إيرادات النشاط | income |
| `income_other` | إيرادات أخرى | income |
| `expense` | مصروفات | expense |
| `expense_depreciation` | إهلاك | expense |
| `expense_direct_cost` | تكلفة الإيرادات | expense |
| `off_balance` | خارج الميزانية | — (excluded from BS/P&L) |

**Backfill** (`backend/src/scripts/backfill_account_report_type.py`, dry-run by default, prints a
review CSV, writes only to our Postgres):

1. System types: `treasury`→`asset_cash` · `custody`→`asset_current` · `customer_receivable`→
   `asset_receivable` · `supplier_payable`→`liability_payable` · `sales_revenue`→`income` ·
   `purchases_expense`→`expense_direct_cost` · `loyalty_expense`→`expense` ·
   `opening_balance_equity`→`equity`.
2. Income/expense `user_defined` accounts: from the income sheet role (saved role, else
   `default_role`) — this carries over every decision the client already made in the income-sheet
   settings:

   | income-sheet role | report_type |
   |---|---|
   | sales, sales_returns, sales_discount | `income` (returns / discount are contra, debit balance) |
   | purchases, purchase_returns, direct_labor, indirect_materials, indirect_labor, other_mfg | `expense_direct_cost` |
   | ga, marketing | `expense` |
   | other_income | `income_other` |
   | other_loss | `expense` + flag for review (Odoo's "Other Expenses" line is depreciation; the client decides per account) |
   | excluded — «تكلفة المبيعات»، «بضاعة أول/آخر المدة»، «فروق مخزون»، «تقدير تكلفة إنتاج» | `expense_direct_cost` (they *are* cost of revenue; the management view keeps excluding them) |
   | excluded — «تحت راتب»، «المهمات» | **review** (they look like advances/custody → `asset_current`) |
   | unclassified | by nature (`income_other` / `expense`) + review |
3. Asset/liability `user_defined`: set on the **group** accounts only (children inherit). Initial
   guess by a5 `main_level` / name keywords (خزينة/بنك → `asset_cash`, أصول ثابتة/سيارات/آلات →
   `asset_fixed`, مجمع إهلاك → `asset_fixed` contra, قروض → `liability_non_current`, رأس المال/جاري
   الشركاء → `equity`), everything else `asset_current` / `liability_current` + review.
4. `appears_in` stays (a5 compatibility, used by a5-style screens) but reports stop reading it.

The review CSV is meant to be walked through **with the client's accountant** before Phase A goes
live — a wrong type silently moves money between P&L sections.

### 5.2 Cash-flow tag

`account.cash_flow_tag` (nullable: `operating` · `investing` · `financing`), Odoo's account tags
for the cash-flow report. Backfill from the current heuristics in `cash_flow_service`; the service
reads the tag first and falls back to the heuristic.

### 5.3 Fiscal year and undistributed earnings

* `accounting_setting.fiscal_year_last_month` (int, default 12), `fiscal_year_last_day` (default 31).
* A system account «أرباح وخسائر غير موزعة» (code `3.999`, `equity_unaffected`, `is_system`) seeded
  by `chart_service.seed_standard_chart`. Never posted to by the system; an accountant *may*
  allocate it with a manual entry (Odoo behaviour).
* No closing entry, no data change: TB / BS / P&L compute the split in SQL by date.

### 5.4 Cost of revenue in the ledger: periodic valuation entries (Odoo "manual/periodic")

* New journal «تقييم المخزون» (`STV`, kind `general`) and system accounts «المخزون» (`asset_current`)
  and «تغير المخزون» (`expense_direct_cost`) per branch.
* Period closing gets «قيد تقييم المخزون»: per branch and month, compute
  `closing_value − opening_value` with the **same** `inventory_valuation_service.values_at` the
  income sheet uses (respecting `cost_basis`, `exclude_categories`), create a **draft** entry
  Dr «المخزون» / Cr «تغير المخزون» (or the reverse), the accountant reviews and posts. Idempotent:
  one entry per (branch, month), regenerated while still draft.
* Opening stock: one-time entry for the stock value at the start of the books (check first whether
  the a5 opening entry already carries an inventory balance — see risks).
* With this, ledger COGS = purchases (+ manufacturing roles) − Δ inventory = the management view's
  **periodic** method, and the income-sheet bridge row «تغير المخزون» goes to zero.
* Perpetual / Anglo-Saxon (COGS posted per sale from the frozen `unit_cost`) is P3 and must not run
  together with periodic entries for the same branch (Odoo: one valuation mode per product category).

### 5.5 Inter-branch parties

* `customer.branch_ref_id` and `supplier.branch_ref_id` (nullable FK `branch.id`): «يمثل فرع».
  Required for every `customer_type = 'internal'` / `supplier_type = 'internal'` card; a small
  admin list «الحسابات بين الفروع» to set them (there are only a handful: A5-2, A5-3, AL-A5-10,
  AL-A5X4 …).
* No change to ledger rows: lines already carry `partner_kind/partner_id` (032 phase 2 — lines
  inherit the entry partner), so the elimination is a `WHERE partner IN internal` aggregate.

### 5.6 How our special sections fit

| Our section | Odoo equivalent | Decision |
|---|---|---|
| Sales categories (الفروع · بولي · قطعي · صرف) from invoices | None in the P&L; Odoo would use separate income accounts per product category or an analytic plan | Keep only in «قائمة الدخل الإدارية». The ledger P&L unfolds revenue by account. (P3 option: income account per product category on posting.) |
| Bonus % per category («البونص») | Free goods are zero-priced lines; their cost is in COGS automatically | Management view only (it is a marketing-cost estimate) |
| Coupon / points marketing model | An accrual entry (provision) | P3: monthly draft entry «استحقاق تكلفة الكوبونات» from the model (Dr مصروفات تسويق / Cr مخصص كوبونات مستحقة). Until then: management view + bridge row |
| Manual «زيادة» items and «جرد فعلي» overrides stored in report config | Everything is a journal entry | Keep in management view; add «تحويل إلى قيد» which creates a draft misc entry. The ledger P&L never reads config |
| COGS periodic / frozen-cost "perpetual" | Periodic (manual) / perpetual (automated, Anglo-Saxon) | Periodic via §5.4 now; perpetual P3 |
| Manufacturing roles (direct labor, indirect materials …) | All `expense_direct_cost` | Same type; the management view keeps the detailed cost sheet |
| Bridge «المطابقة مع الدفاتر» | Not needed in Odoo (one source) | Keep in management view; its residual should trend to the inventory and marketing rows only |

---

## 6. Screen designs

All screens are RTL: the label column is on the right, amounts on the left. Labels are the exact
Modern Standard Arabic strings to use. No explanatory text inside the screens.

### 6.0 Options bar (shared component `AccountingReportOptions`)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ [الفترة: هذه السنة المالية ▾] [المقارنة: بدون ▾] [الفروع: كل الفروع ▾] [الدفاتر: الكل ▾] │
│ [مراكز التكلفة ▾] [خيارات ▾]                       [فتح الكل] [طي الكل] [PDF] [Excel]     │
└────────────────────────────────────────────────────────────────────────────────────────┘
الفترة ▾        : هذا الشهر · هذا الربع · هذه السنة المالية · الشهر الماضي · الربع الماضي ·
                  السنة المالية الماضية · فترة مخصصة (من — إلى) · (BS: «حتى تاريخ»)
المقارنة ▾      : بدون · الفترة السابقة · نفس الفترة من العام الماضي · عدد الفترات [1..12]
الفروع ▾        : ☑ كل الفروع · ☐ أكتوبر · ☐ العلياء · ☐ السادات
                  ☐ عمود لكل فرع · ☐ استبعاد المعاملات بين الفروع
خيارات ▾        : ☐ تضمين المسودات · ☑ إخفاء الأرصدة الصفرية · ☑ التجميع بشجرة الحسابات
```

### 6.1 Accounting dashboard («لوحة المحاسبة»)

```
┌ لوحة المحاسبة ─────────────────────────────── [قائمة الدخل] [الميزانية] [ميزان المراجعة] ┐
│                                                                                          │
│ ┌ المبيعات  SAL ─────────────[فاتورة بيع جديدة]┐ ┌ المشتريات PUR ────────[فاتورة شراء جديدة]┐│
│ │ مسودات للترحيل        3                       │ │ فواتير للسداد        14   312,400.00   ││
│ │ متأخرة السداد         12   145,000.00         │ │ متأخرة السداد         4    58,000.00   ││
│ │ ▁▃▅▂▆  متأخرة · هذا الأسبوع · الأسابيع القادمة │ │ ▂▂▅▃▁                                  ││
│ │ [الفواتير] [المردودات] [تسوية]                │ │ [الفواتير] [المردودات] [تسوية]         ││
│ └───────────────────────────────────────────────┘ └────────────────────────────────────────┘│
│ ┌ الخزينة الرئيسية CSH1 ─────────[سند قبض][سند صرف]┐ ┌ بنك مصر BNK1 ───────────[تحويل]┐    │
│ │ الرصيد في الدفاتر   84,210.00                     │ │ الرصيد في الدفاتر  1,204,000.00  │    │
│ │ ╱╲__╱‾‾╲_  آخر ٣٠ يومًا                           │ │ __╱‾‾‾╲__                        │    │
│ │ [الحركة] [تحويل بين الخزن]                        │ │ [الحركة]                         │    │
│ └───────────────────────────────────────────────────┘ └──────────────────────────────────┘    │
│ ┌ قيود متنوعة MISC ──────────────[قيد جديد]┐ ┌ تقييم المخزون STV ─────[قيد تقييم المخزون]┐  │
│ │ مسودات للترحيل   2                         │ │ آخر قيد: 2026/09/30                       │  │
│ │ [قيود الدفتر]                              │ │ [قيود الدفتر]                              │  │
│ └────────────────────────────────────────────┘ └───────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 P&L («قائمة الدخل») — two views on one page

Tabs: «القائمة» (ledger, Odoo layout) · «العرض الإداري» (today's statement, untouched) · «الإعدادات».

```
قائمة الدخل                         [options bar]
┌────────────────────────────────────┬───────────────┬───────────────┬─────────┐
│                                    │ 2026/01–2026/09│ 2025/01–2025/09│ التغير % │
├────────────────────────────────────┼───────────────┼───────────────┼─────────┤
│ ▾ الإيرادات                         │ 18,420,000.00 │ 15,010,000.00 │  22.7 % │
│    ▸ 4.01 إيرادات المبيعات           │ 19,100,000.00 │               │         │
│    ▸ 4.02 مردودات المبيعات           │   −520,000.00 │               │         │
│    ▸ 4.03 خصم مسموح به               │   −160,000.00 │               │         │
│ ▾ يُطرح: تكلفة الإيرادات             │ 13,900,000.00 │               │         │
│    ▸ 5.01 المشتريات                 │               │               │         │
│    ▸ 5.09 تغير المخزون              │               │               │         │
│    ▸ 5.1x أجور مباشرة …             │               │               │         │
│ ═ مجمل الربح                        │  4,520,000.00 │               │         │
│ ▸ يُطرح: المصروفات التشغيلية          │  2,100,000.00 │               │         │
│ ═ الربح التشغيلي                     │  2,420,000.00 │               │         │
│ ▸ يُضاف: إيرادات أخرى                 │     80,000.00 │               │         │
│ ▸ يُطرح: مصروفات أخرى                 │     95,000.00 │               │         │
│ ═ صافي الربح                         │  2,405,000.00 │               │         │
└────────────────────────────────────┴───────────────┴───────────────┴─────────┘
⚠ لم يُرحَّل قيد تقييم المخزون لشهري 08 و09 (القيمة المحسوبة: 310,000.00)  [إنشاء القيد]
```

With «عمود لكل فرع» + «استبعاد المعاملات بين الفروع» (all branches selected):

```
│                       │ أكتوبر │ العلياء │ السادات │ استبعادات بين الفروع │ المجمّع │
│ ▾ الإيرادات            │  …     │  …      │  …      │      −2,300,000.00   │   …     │
│ ▾ يُطرح: تكلفة الإيرادات │  …     │  …      │  …      │      −2,300,000.00   │   …     │
│ ═ مجمل الربح           │  …     │  …      │  …      │              0.00    │   …     │
│   فرق مطابقة بين الفروع │        │         │         │          12,500.00   │         │
```

Clicking any amount: menu «دفتر الأستاذ العام» · «بنود القيود». Clicking the eliminations cell:
the list of inter-branch documents behind it.

### 6.3 Balance sheet («الميزانية»)

```
الميزانية — حتى 2026/09/30              [options bar: حتى تاريخ · مقارنة · فروع]
│ ▾ الأصول                                      │ 9,800,000.00 │
│   ▾ الأصول المتداولة                           │              │
│      ▸ النقدية والبنوك                          │              │
│      ▸ الذمم المدينة   (٢٬٣١٠ عميل — يُفتح عند الطلب)│           │
│      ▸ أصول متداولة أخرى                        │              │
│      ▸ مصروفات مدفوعة مقدمًا                     │              │
│   ▸ يُضاف: الأصول الثابتة                        │              │
│   ▸ يُضاف: الأصول غير المتداولة                  │              │
│ ═ إجمالي الأصول                                │              │
│ ▾ الالتزامات                                   │              │
│   ▸ الالتزامات المتداولة                        │              │
│   ▸ الذمم الدائنة                               │              │
│   ▸ يُضاف: الالتزامات غير المتداولة              │              │
│ ▾ حقوق الملكية                                 │              │
│   ▾ الأرباح غير الموزعة                         │              │
│      أرباح العام الحالي                         │              │
│      أرباح سنوات سابقة غير موزعة                │              │
│   ▸ رأس المال والأرباح المحتجزة                  │              │
│ ═ إجمالي الالتزامات وحقوق الملكية               │              │
```

### 6.4 Trial balance («ميزان المراجعة»)

```
ميزان المراجعة                [options bar]   [فتح الكل] [طي الكل] [PDF] [Excel]
┌──────────────────────┬──── الرصيد الافتتاحي ───┬──── حركة الفترة ────┬── رصيد آخر المدة ──┐
│ الحساب                │   مدين    │   دائن     │   مدين   │   دائن   │   مدين   │   دائن  │
├──────────────────────┼───────────┼────────────┼──────────┼──────────┼──────────┼─────────┤
│ ▾ 1 الأصول            │           │            │          │          │          │         │
│   ▸ 1.01 الأصول المتداولة │        │            │          │          │          │         │
│ ▸ 2 الالتزامات         │           │            │          │          │          │         │
│ ▸ 3 حقوق الملكية       │           │            │          │          │          │         │
│     3.999 أرباح وخسائر غير موزعة │  │ 1,950,000  │          │          │          │1,950,000│
│ ▸ 4 الإيرادات          │  (0 at FY start)       │          │          │          │         │
│ ▸ 5 التكلفة والمصروفات  │  (0 at FY start)       │          │          │          │         │
├──────────────────────┼───────────┼────────────┼──────────┼──────────┼──────────┼─────────┤
│ الإجمالي              │           │            │          │          │          │         │
└──────────────────────┴───────────┴────────────┴──────────┴──────────┴──────────┴─────────┘
(with comparison: one «مدين · دائن» group per comparison period between the opening and the period)
```

### 6.5 General ledger and drill-down («دفتر الأستاذ العام»)

```
دفتر الأستاذ العام                [options bar + بحث بالحساب أو الكود]
│ الحساب / التاريخ    │ القيد          │ البيان        │ الشريك      │  مدين  │  دائن  │ الرصيد  │
│ ▾ 1.01.001 الخزينة   │                │               │             │ 912,000│ 870,000│  84,210 │
│     الرصيد الافتتاحي │                │               │             │        │        │  42,210 │
│     2026/01/03      │ CSH1/2026/0001 │ سند قبض       │ محمد علي    │  3,000 │        │  45,210 │
│     …               │                │               │             │        │        │         │
│     [تحميل المزيد — ٢٠٠ من ٤٬٣١٠]                                                            │
│     إجمالي 1.01.001 الخزينة                                       │ 912,000│ 870,000│  84,210 │
│ ▸ 4.01 إيرادات المبيعات                                            │        │        │         │
```

Row click → entry modal (existing `JournalTab` view) → «فتح المستند». Account name click →
«كشف حساب» (`/account-statement`, unchanged).

### 6.6 Navigation («اداره الحسابات»)

```
اداره الحسابات
  لوحة المحاسبة
  قائمة الدخل                 (/income-sheet — tabs: القائمة · العرض الإداري · الإعدادات)
  الميزانية
  ميزان المراجعة              (moved up from «التقارير المالية»)
  دفتر الأستاذ العام          (new)
  كشف حساب
  القيود والسندات ▸ (unchanged)
  التقارير المالية ▸
      دفتر الشريك · أعمار ديون العملاء · أعمار ديون الموردين · قائمة التدفقات النقدية (new link)
      رواكد مديونية العملاء · قيمة المخزون … · أرباح مراكز التكلفة · مقارنة الفروع
  …
  إقفال الفترة ▸ (+ «قيد تقييم المخزون»)
```

---

## 7. Phased implementation plan

Each phase ships alone, behind no flag unless noted, and is verified from the screens on staging
(`app.technothermeg.com/staging`) before production. All aggregation in SQL.

| Phase | Content | Done when | Risk |
|---|---|---|---|
| **A — Account types** (P1, M) | Migration `report_type` (+ `cash_flow_tag`), `effective_report_type`, backfill script (dry-run CSV → review with the accountant → apply), dropdown in MainAccounts/SubAccounts, «حسابات بلا نوع» filter. Fix the dashboard's broken link | Every account with movement has an effective type; the review CSV signed off | Wrong mapping moves money between sections silently → mandatory review; nothing reads the column yet, so zero production impact |
| **B — Options bar + ledger P&L** (P1, M) | `ReportOptions` extension, `AccountingReportOptions` component, `pl_report_service`, tab «القائمة» on `/income-sheet` (existing view becomes «العرض الإداري»), drill-down to GL/account statement, PDF/Excel, comparison ×N | Net profit of the new P&L == `ledger_net_profit` of today's bridge for the same filters; sum of lines == sum of income/expense accounts in the TB | User sees two different net profits → label them and show the bridge link from the management view |
| **C — Fiscal year, BS, TB** (P1, M) | FY settings + `equity_unaffected` account; TB `fy_aware` + synthetic row; `bs_report_service` Odoo layout; lazy children for customer/supplier groups; TB/BS on the shared options bar | TB balances for any range; BS «فرق التوازن» = 0; BS current-year earnings == P&L net for FY-to-date | Lazy loading changes print/export → export fetches the full tree server-side |
| **D — General ledger** (P1, M) | `gl_report_service` summary + paged lines (window function), `/general-ledger?tab=gl`, nav item | Account totals == TB; running balance end == TB closing | Large accounts (customers group, sales) → paging 200 + SQL window; never load all lines |
| **E — Inter-branch** (P1, M) | `branch_ref_id` on internal parties + admin list; `split_by_branch` and `eliminate_inter_branch` in P&L / BS / TB; mismatch line «فرق مطابقة بين الفروع»; report «مطابقة المعاملات بين الفروع» (pairs: sales of A to B vs purchases of B from A per month) | With eliminations, consolidated revenue excludes every invoice whose partner is an internal party; mismatch report explains the difference line | Legacy a5 inter-branch docs may be one-sided (sale recorded, purchase missing) → difference line + report make it visible instead of hiding it |
| **F — Inventory valuation entries** (P1/P2, M) | STV journal, accounts, period-closing action, warning row in P&L, opening-stock entry | Ledger P&L COGS == management view periodic COGS for the same month/branch (± excluded categories) | Double counting if the a5 opening entry already holds stock; must be checked on a copy first. Interplay with `eliminate_inter_branch`: the average-cost book includes internal purchase prices, so unrealized inter-branch margin stays in closing stock (P3: company-wide cost excluding internal invoices) |
| **G — Dashboard** (P2, S) | Late/overdue, to-validate, weekly bars, GL balance sparkline, merge treasury into cash/bank cards | Numbers match the invoice list filters they link to | — |
| **H — Rest** (P2/P3) | Aging buckets as Odoo, cash-flow tab + tags, partner ledger on options bar, executive summary, coupon accrual entry, perpetual/Anglo-Saxon valuation, annotations/audit, budgets | — | Perpetual valuation must not coexist with periodic entries |

### Cross-cutting risks

* **Another agent is changing `income_statement_service` / `trial_balance_service` now** (uncommitted
  `eliminate_internal`, COGS methods, `branch_sql` change). Phases B/C must start from the committed
  result of that work; the management view logic is not touched by this spec.
* **`branch_sql` change in the working copy**: `financial_reports_service` used to include entries
  with `branch_id IS NULL` in a branch filter; the working copy now uses `branch_sql`
  (`branch_id == X` only). Company-level entries (no branch) disappear from branch reports — decide
  explicitly (Odoo: a branch report shows only that branch's journal items; parent-company items
  appear only when the parent is selected) and show «بدون فرع» as its own column in
  `split_by_branch`.
* **Per-customer accounts** (thousands of leaves) — every tree must lazy-load groups and every
  export must aggregate server-side.
* **History from a5**: account names drive today's roles; Odoo types make that explicit. Any
  account renamed later keeps its type (no more keyword drift).
