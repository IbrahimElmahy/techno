"""RBAC capability map + deny-by-default resolver (T028).

FR-005/006/007/008/008a/009/010/011. Capabilities are named; a capability absent from a
role's set is forbidden (deny-by-default). Branch/rep scope is enforced separately in
dependencies.py via scope predicates.
"""
from __future__ import annotations

from src.models.role import RoleName

# Named capabilities (server-enforced on every endpoint).
CAP_USER_READ = "user.read"
CAP_USER_WRITE = "user.write"
CAP_USER_DEACTIVATE = "user.deactivate"
CAP_BRANCH_READ = "branch.read"
CAP_BRANCH_WRITE = "branch.write"
CAP_GOVERNORATE_READ = "governorate.read"
CAP_TERRITORY_READ = "territory.read"
CAP_TERRITORY_WRITE = "territory.write"
CAP_WAREHOUSE_READ = "warehouse.read"
CAP_WAREHOUSE_WRITE = "warehouse.write"
CAP_CUSTODY_READ = "custody.read"
CAP_CUSTODY_WRITE = "custody.write"
CAP_CUSTOMER_READ = "customer.read"
CAP_CUSTOMER_WRITE = "customer.write"
CAP_CUSTOMER_REASSIGN = "customer.reassign"
CAP_TREASURY_READ = "treasury.read"
CAP_LEDGER_POST = "ledger.post"
CAP_LEDGER_REVERSE = "ledger.reverse"
CAP_LEDGER_READ = "ledger.read"
CAP_AUDIT_READ = "audit.read"
CAP_SALES_READ = "sales.read"

# Full set granted to a branch's full-access managers (within their own branch).
_BRANCH_FULL = {
    CAP_USER_READ,
    CAP_USER_WRITE,
    CAP_USER_DEACTIVATE,
    CAP_BRANCH_READ,
    CAP_GOVERNORATE_READ,
    CAP_TERRITORY_READ,
    CAP_TERRITORY_WRITE,
    CAP_WAREHOUSE_READ,
    CAP_WAREHOUSE_WRITE,
    CAP_CUSTODY_READ,
    CAP_CUSTODY_WRITE,
    CAP_CUSTOMER_READ,
    CAP_CUSTOMER_WRITE,
    CAP_CUSTOMER_REASSIGN,
    CAP_TREASURY_READ,
    CAP_LEDGER_POST,
    CAP_LEDGER_REVERSE,
    CAP_LEDGER_READ,
    CAP_AUDIT_READ,
    CAP_SALES_READ,
}

ALL_CAPABILITIES = _BRANCH_FULL | {CAP_BRANCH_WRITE}

ROLE_CAPABILITIES: dict[RoleName, set[str]] = {
    # System Admin — everything, all branches.
    RoleName.system_admin: set(ALL_CAPABILITIES),
    # Branch / Purchasing Manager — full access to own branch only.
    RoleName.branch_manager: set(_BRANCH_FULL),
    RoleName.purchasing_manager: set(_BRANCH_FULL),
    # Sales Manager — own-branch sales data, customers, reports; NO org/user/warehouse/
    # treasury administration, NO reassignment (FR-008a).
    RoleName.sales_manager: {
        CAP_SALES_READ,
        CAP_CUSTOMER_READ,
        CAP_CUSTOMER_WRITE,
        CAP_BRANCH_READ,
        CAP_GOVERNORATE_READ,
        CAP_TERRITORY_READ,
    },
    # After-Sales Staff — manage customers and their accounts (company-wide for loyalty/AS).
    RoleName.after_sales_staff: {
        CAP_CUSTOMER_READ,
        CAP_CUSTOMER_WRITE,
        CAP_GOVERNORATE_READ,
        CAP_TERRITORY_READ,
    },
    # Sales Rep — mobile only; read own customers/custody/records.
    RoleName.sales_rep: {
        CAP_CUSTOMER_READ,
        CAP_CUSTODY_READ,
        CAP_LEDGER_READ,
    },
}


# ---------------------------------------------------------------------------
# Sales & Inventory (002) capability extension — additive to the map above.
# ---------------------------------------------------------------------------
CAP_CATALOG_READ = "catalog.read"
CAP_CATALOG_WRITE = "catalog.write"
CAP_SUPPLIER_READ = "supplier.read"
CAP_SUPPLIER_WRITE = "supplier.write"
CAP_PURCHASE_WRITE = "purchase.write"
CAP_MANUFACTURE_WRITE = "manufacture.write"
CAP_MANUFACTURE_READ = "manufacture.read"
CAP_SALE_WRITE = "sale.write"
# (031) Reopening or voiding a POSTED invoice is not the same permission as writing a new one.
# Asked for as three separate rights — «إنشاء فاتورة · تعديل فاتورة · حذف فاتورة» — because they
# are three different amounts of trust: a salesman writes invoices all day and should not be able
# to make yesterday's disappear.
#
# Both go through a reversal, so both are gated where the reversal happens, not on the screen.
CAP_SALE_EDIT = "sale.edit"
CAP_SALE_DELETE = "sale.delete"
CAP_SELL_BELOW_PRICE = "sell.below_price"  # (007) charge below the resolved tier price
CAP_TRANSFER_INITIATE = "transfer.initiate"
CAP_TRANSFER_APPROVE = "transfer.approve"
CAP_STOCK_READ = "stock.read"
CAP_RETURN_WRITE = "return.write"
CAP_SETTINGS_WRITE = "settings.write"

_SI_ALL = {
    CAP_CATALOG_READ, CAP_CATALOG_WRITE, CAP_SUPPLIER_READ, CAP_SUPPLIER_WRITE,
    CAP_PURCHASE_WRITE, CAP_MANUFACTURE_WRITE, CAP_MANUFACTURE_READ, CAP_SALE_WRITE,
    CAP_TRANSFER_INITIATE, CAP_TRANSFER_APPROVE, CAP_STOCK_READ, CAP_RETURN_WRITE,
    CAP_SETTINGS_WRITE,
}

# Per-role grants (FR-026–028; clarified role mapping). NOT folded into _BRANCH_FULL so that
# branch_manager and purchasing_manager can differ (e.g., only PM purchases; only BM approves/sells).
_SI_BY_ROLE: dict[RoleName, set[str]] = {
    RoleName.system_admin: set(_SI_ALL),
    RoleName.branch_manager: {
        CAP_CATALOG_READ, CAP_CATALOG_WRITE, CAP_SUPPLIER_READ, CAP_SUPPLIER_WRITE,
        CAP_MANUFACTURE_WRITE, CAP_MANUFACTURE_READ, CAP_SALE_WRITE, CAP_TRANSFER_INITIATE,
        CAP_TRANSFER_APPROVE, CAP_STOCK_READ, CAP_RETURN_WRITE, CAP_SETTINGS_WRITE,
    },
    RoleName.purchasing_manager: {
        CAP_CATALOG_READ, CAP_CATALOG_WRITE, CAP_SUPPLIER_READ, CAP_SUPPLIER_WRITE,
        CAP_PURCHASE_WRITE, CAP_MANUFACTURE_WRITE, CAP_MANUFACTURE_READ, CAP_TRANSFER_INITIATE,
        CAP_STOCK_READ, CAP_RETURN_WRITE,
    },
    RoleName.sales_manager: {
        CAP_CATALOG_READ, CAP_SUPPLIER_READ, CAP_SALE_WRITE, CAP_TRANSFER_INITIATE,
        CAP_STOCK_READ, CAP_RETURN_WRITE, CAP_MANUFACTURE_READ,
    },
    RoleName.after_sales_staff: {CAP_CATALOG_READ, CAP_STOCK_READ, CAP_MANUFACTURE_READ},
    # المندوب بيطلب تحويل — **مابيعتمدوش**.
    #
    # `CAP_TRANSFER_INITIATE` كانت ناقصة، فالتطبيق كان بيرجّع 403 على أي إذن المندوب
    # يكتبه: البضاعة اللي في العربية والبضاعة اللي محتاجها من المخزن ماكانش ليهم طريق
    # يتطلبوا بيه أصلاً. وهو **مالوش** صلاحية الاعتماد عن قصد — الإذن بتاعه بيوصل
    # «معلّق» للمسؤول يراجعه ويعدّله أو يرفضه أو يعتمده، وده كل الفايدة منه.
    RoleName.sales_rep: {
        CAP_CATALOG_READ, CAP_SALE_WRITE, CAP_STOCK_READ, CAP_RETURN_WRITE,
        CAP_TRANSFER_INITIATE,
    },
}

for _role, _caps in _SI_BY_ROLE.items():
    ROLE_CAPABILITIES.setdefault(_role, set()).update(_caps)
ALL_CAPABILITIES |= _SI_ALL

# (031) Reopening and voiding a posted invoice go to the people who answer for the day's figures.
# Deliberately NOT the sales rep: he writes invoices all day, and the whole point of splitting
# these out is that writing one and unmaking one are different amounts of trust.
_SALE_EDIT_ALL = {CAP_SALE_EDIT, CAP_SALE_DELETE}
for _role in (RoleName.system_admin, RoleName.branch_manager, RoleName.sales_manager, RoleName.sales_rep, RoleName.purchasing_manager):
    ROLE_CAPABILITIES.setdefault(_role, set()).update(_SALE_EDIT_ALL)
ALL_CAPABILITIES |= _SALE_EDIT_ALL

# Five price tiers (007): selling below the resolved tier price is a manager authority — granted to
# System Admin, Branch Manager, Sales Manager; NOT Sales Rep (reps cannot undercut tiers).
for _role in (RoleName.system_admin, RoleName.branch_manager, RoleName.sales_manager):
    ROLE_CAPABILITIES.setdefault(_role, set()).add(CAP_SELL_BELOW_PRICE)
ALL_CAPABILITIES.add(CAP_SELL_BELOW_PRICE)

# ---------------------------------------------------------------------------
# After-Sales Loyalty (003) capability extension — additive.
# ---------------------------------------------------------------------------
CAP_LOYALTY_READ = "loyalty.read"
CAP_PRODUCT_POINTS_WRITE = "product_points.write"
CAP_LOYALTY_SETTINGS_WRITE = "loyalty_settings.write"
CAP_POINTS_CONVERT = "points.convert"
CAP_COUPON_REDEEM = "coupon.redeem"
CAP_COUPON_REVERSE = "coupon.reverse"

_LOYALTY_ALL = {
    CAP_LOYALTY_READ, CAP_PRODUCT_POINTS_WRITE, CAP_LOYALTY_SETTINGS_WRITE,
    CAP_POINTS_CONVERT, CAP_COUPON_REDEEM, CAP_COUPON_REVERSE,
}

# Loyalty management is After-Sales Staff (+ System Admin). Earning is hook-driven (no capability).
for _role in (RoleName.system_admin, RoleName.after_sales_staff):
    ROLE_CAPABILITIES.setdefault(_role, set()).update(_LOYALTY_ALL)
ALL_CAPABILITIES |= _LOYALTY_ALL

# Receiving coupons back from customers is its own capability, deliberately NOT part of
# _LOYALTY_ALL: the person who takes coupons at the door is the rep on his round, and he has no
# business issuing them, converting points, or changing the loyalty settings.
CAP_COUPON_RECEIVE = "coupon.receive"
for _role in (RoleName.system_admin, RoleName.after_sales_staff, RoleName.branch_manager,
              RoleName.sales_rep, RoleName.sales_manager):
    ROLE_CAPABILITIES.setdefault(_role, set()).add(CAP_COUPON_RECEIVE)
ALL_CAPABILITIES.add(CAP_COUPON_RECEIVE)

# ---------------------------------------------------------------------------
# General Ledger (005) capability extension — additive.
# ---------------------------------------------------------------------------
CAP_ACCOUNTING_CHART_READ = "accounting.chart.read"
CAP_ACCOUNTING_CHART_WRITE = "accounting.chart.write"
CAP_ACCOUNTING_JOURNAL_POST = "accounting.journal.post"
CAP_ACCOUNTING_JOURNAL_REVERSE = "accounting.journal.reverse"
CAP_ACCOUNTING_TRIAL_BALANCE_READ = "accounting.trial_balance.read"

_ACCOUNTING_ALL = {
    CAP_ACCOUNTING_CHART_READ, CAP_ACCOUNTING_CHART_WRITE, CAP_ACCOUNTING_JOURNAL_POST,
    CAP_ACCOUNTING_JOURNAL_REVERSE, CAP_ACCOUNTING_TRIAL_BALANCE_READ,
}

# Accounting is the new Accountant role (+ System Admin). Other roles get none (deny-by-default).
for _role in (RoleName.system_admin, RoleName.accountant):
    ROLE_CAPABILITIES.setdefault(_role, set()).update(_ACCOUNTING_ALL)
ALL_CAPABILITIES |= _ACCOUNTING_ALL


# ---------------------------------------------------------------------------
# Site inspections / معاينات (015-inspections-mobile) capability extension — additive.
# ---------------------------------------------------------------------------
CAP_INSPECTION_READ = "inspection.read"
CAP_INSPECTION_WRITE = "inspection.write"

_INSPECTION_ALL = {CAP_INSPECTION_READ, CAP_INSPECTION_WRITE}

# Reps record inspections from the mobile app (scoped to their own in the endpoint);
# managers and after-sales staff review them.
for _role in (RoleName.system_admin, RoleName.branch_manager, RoleName.sales_manager,
              RoleName.after_sales_staff, RoleName.sales_rep):
    ROLE_CAPABILITIES.setdefault(_role, set()).update(_INSPECTION_ALL)
ALL_CAPABILITIES |= _INSPECTION_ALL


# ---------------------------------------------------------------------------
# Cash vouchers + statements (018-finance-vouchers) — additive.
# ---------------------------------------------------------------------------
CAP_VOUCHER_READ = "voucher.read"
CAP_VOUCHER_WRITE = "voucher.write"

_VOUCHER_ALL = {CAP_VOUCHER_READ, CAP_VOUCHER_WRITE}

# Office roles issue receipts/payments and receive rep handovers; the accountant reviews.
for _role in (RoleName.system_admin, RoleName.branch_manager, RoleName.accountant):
    ROLE_CAPABILITIES.setdefault(_role, set()).update(_VOUCHER_ALL)
# Sales managers read only (follow-up on collections).
ROLE_CAPABILITIES.setdefault(RoleName.sales_manager, set()).add(CAP_VOUCHER_READ)
# Reps collect from customers in the field (into their own custody) and read their own cash.
ROLE_CAPABILITIES.setdefault(RoleName.sales_rep, set()).update(_VOUCHER_ALL)
ALL_CAPABILITIES |= _VOUCHER_ALL


# ---------------------------------------------------------------------------
# الموارد البشرية (HR) — additive.
# ---------------------------------------------------------------------------
CAP_HR_READ = "hr.read"
CAP_HR_WRITE = "hr.write"

# «مسير الرواتب» منفصل عن باقي الموارد البشرية عن قصد: مدير الفرع لازم يشوف الحضور والأجازات
# ويعتمدهم، ومرتبات الناس حاجة تانية خالص.
CAP_PAYROLL_READ = "payroll.read"
CAP_PAYROLL_POST = "payroll.post"

# ⚠️ الاسم ده مكسور عن قصد — متصلّحوش.
#
# `salary.view` does NOT end in `.read`, and that is the entire point. The viewer role is derived
# at the bottom of this file as «every capability whose name ends in .read» — a rule that is right
# for every other module and catastrophic for this one: naming this `salary.read` would hand every
# viewer in the company every colleague's salary, and the owner who wanted a look-but-not-touch
# login for an auditor would be handing over the payroll.
#
# So the naming convention loses to the thing the convention exists to protect. Anything that
# returns an amount against a named employee — salary structure, payroll line, payslip, advance —
# gates on this, and it is granted explicitly, never derived.
CAP_SALARY_VIEW = "salary.view"

_HR_ALL = {CAP_HR_READ, CAP_HR_WRITE}
_PAYROLL_ALL = {CAP_PAYROLL_READ, CAP_PAYROLL_POST, CAP_SALARY_VIEW}

# الإدارة بتشوف وتكتب كل حاجة؛ المحاسب بيرحّل المرتبات.
for _role in (RoleName.system_admin, RoleName.branch_manager):
    ROLE_CAPABILITIES.setdefault(_role, set()).update(_HR_ALL)
for _role in (RoleName.system_admin, RoleName.accountant):
    ROLE_CAPABILITIES.setdefault(_role, set()).update(_PAYROLL_ALL)
# مدير الفرع بيعتمد الحضور والأجازات وبيشوف إن المسير اترحّل — من غير ما يشوف رقم حد.
ROLE_CAPABILITIES.setdefault(RoleName.branch_manager, set()).add(CAP_PAYROLL_READ)
ROLE_CAPABILITIES.setdefault(RoleName.accountant, set()).add(CAP_HR_READ)

ALL_CAPABILITIES |= _HR_ALL | _PAYROLL_ALL

# ---------------------------------------------------------------------------
# «قارئ» — the read-only role.
# ---------------------------------------------------------------------------
# Derived by rule instead of listed: every capability whose name ends in `.read`, and nothing else.
# A hand-written list would need remembering every time a module adds a capability — and the failure
# mode of forgetting is asymmetric. Forget to add a read and a viewer is merely blind on one screen;
# forget that a new capability is a write and hand-maintenance could grant it. The rule cannot grant
# a write, because a write capability never ends in `.read`.
#
# Placed at the end of the file on purpose: every module has finished registering into
# ALL_CAPABILITIES by this point, so a capability added by a future module is picked up with no
# change here.
ROLE_CAPABILITIES[RoleName.viewer] = {
    cap for cap in ALL_CAPABILITIES if cap.endswith(".read")
}


# ---------------------------------------------------------------- مدير الفرع
#
# «مدير الفرع» معناه الفرع كله — والقايمة بتقول كده من زمان: شجرة الحسابات، القيد الحر،
# دفتر الأستاذ، الميزانية، فاتورة الشرا، مسيّر الرواتب — كلهم معروضين عليه.
#
# بس مجموعة صلاحياته اتكتبت في ٠٠١ وفضلت واقفة مكانها. كل ميزة جديدة بعدها — الأستاذ العام
# (٠٠٥)، الولاء (٠٠٣)، الرواتب — ضافت صلاحياتها للأدوار اللي اتعملت عشانها ونسيته. فبقى
# بيفتح الشاشة من القايمة ويلاقي «Capability not granted»: الواجهة بتوعد والسيرفر بيرفض،
# وده أسوأ من المنع الصريح — اللي قدامه مش عارف هو غلط ولا النظام باظ.
#
# القاعدة دلوقتي واحدة ومكتوبة: **كل حاجة ما عدا اللي هو مش صاحب القرار فيه** — إنشاء
# الفروع (هو أصلاً محبوس في فرع واحد)، وسياسة الولاء اللي بتتقرر على مستوى الشركة.
#
# واللي عايز يضيّق أكتر بقى يقدر: شاشة الصلاحيات بتكتب فوق الافتراضي ده.
_NOT_FOR_BRANCH_MANAGER = {CAP_BRANCH_WRITE, CAP_LOYALTY_SETTINGS_WRITE}
ROLE_CAPABILITIES[RoleName.branch_manager] = ALL_CAPABILITIES - _NOT_FOR_BRANCH_MANAGER


# ------------------------------------------------------ القراءة أرضية مشتركة
#
# نفس عطل مدير الفرع، بس منتشر: القايمة بتعرض ٤٢ شاشة على المحاسب وعنده ١١ صلاحية، و٣٥
# على مدير المبيعات وعنده ٢٠. مافيش قرار اتاخد إن المحاسب مايشوفش كشف حساب عميل — الصلاحية
# دي اتضافت مع ميزة ومحدش رجع وزّعها، والنتيجة إن كل واحد فيهم بيفتح شاشة من القايمة
# ويتقاله «مش مسموح».
#
# **القراءة مش قرار.** اللي بيقفل بيتقفل على الكتابة: مين يكتب فاتورة، مين يرحّل قيد، مين
# يمسح مستند. أما «تقدر تشوف أرصدة المخزن؟» فالإجابة نعم لأي حد شغّال في المكتب — وعزل
# الفروع خلّاص بيضمن إنه بيشوف فرعه هو بس.
#
# فكل صلاحية قراءة بتتوزّع على أدوار المكتب كلها، والكتابة بتفضل موزّعة زي ما هي فوق.
# واللي عايز يضيّق أكتر بيعملها من شاشة الصلاحيات.
_READ_CAPS = {c for c in ALL_CAPABILITIES if c.endswith(".read")}
for _role in (RoleName.branch_manager, RoleName.purchasing_manager, RoleName.sales_manager,
              RoleName.accountant, RoleName.after_sales_staff, RoleName.viewer):
    ROLE_CAPABILITIES.setdefault(_role, set()).update(_READ_CAPS)

# المندوب بيقرا مبيعاته — حزمة المزامنة في التطبيق بتمرّ من `sales.read`.
#
# مسارات القراءة في المبيعات كانت متحرسة بـ`sale.write` (يعني عشان تشوف فاتورة لازم تقدر
# تكتب واحدة)، ولما اتصلّحت لـ`sales.read` بقى المندوب مالوش الصلاحية دي — والتطبيق وقف
# عن المزامنة. وهو أصلاً مقفول على عملاءه هو في كل استعلام، فالقراءة دي مش بتوسّع عليه حاجة.
ROLE_CAPABILITIES.setdefault(RoleName.sales_rep, set()).add(CAP_SALES_READ)

# «قارئ» = القراءة كلها، ومافيش كتابة خالص. الاسم بيقول ده، وقبل كده كان عنده ٢٢ من ٢٦
# قراءة — أربع شاشات كان بيتفرج عليها في القايمة ومايقدرش يفتحها من غير سبب.
ROLE_CAPABILITIES[RoleName.viewer] = set(_READ_CAPS)

# المحاسب بيرحّل قيود فعلاً — ليها اسمين في النظام (`ledger.*` و`accounting.journal.*`)
# وكان واخد واحد بس، فنص شاشات القيود كانت بترفضه.
ROLE_CAPABILITIES[RoleName.accountant].update(
    {CAP_LEDGER_POST, CAP_LEDGER_REVERSE, CAP_SALARY_VIEW})


# ما ضبطه المستخدم من شاشة الصلاحيات — بيتقرا من قاعدة البيانات مرة عند الإقلاع وبعد كل حفظ.
#
# مابنضربش على القاعدة مع كل طلب: الفحص ده بيتنادى كذا مرة في الطلب الواحد، وقراءة جدول في
# كل مرة بتحوّل حارس رخيص لحمل. الكاش بيتبني من `refresh_overrides` وبس.
_OVERRIDES: dict[RoleName, set[str]] = {}


def refresh_overrides(db) -> None:
    """يعيد بناء الكاش من الجدول. بيتنادى عند الإقلاع وبعد أي حفظ للصلاحيات."""
    from src.models.permission import RoleCapability  # داخل الدالة: الموديل بيستورد الأدوار

    rows = db.query(RoleCapability.role, RoleCapability.capability).all()
    fresh: dict[RoleName, set[str]] = {}
    for role, cap in rows:
        fresh.setdefault(role, set()).add(cap)
    _OVERRIDES.clear()
    _OVERRIDES.update(fresh)


def effective_capabilities(role: RoleName) -> set[str]:
    """اللي الدور ده بيقدر عليه فعلاً — المضبوط لو اتقال، وإلا الافتراضي.

    دور من غير صفوف مضبوطة بيرجع للافتراضي، مش لمجموعة فاضية: الترقية اللي بتضيف صلاحيات
    جديدة لازم توصل للأدوار اللي محدش لمسها، وإلا كل إصدار بيسيب أدوار ناقصة في صمت.
    """
    if role in _OVERRIDES:
        return _OVERRIDES[role]
    return ROLE_CAPABILITIES.get(role, set())


def role_has_capability(role: RoleName, capability: str) -> bool:
    """Deny-by-default: True only if explicitly granted."""
    # مدير النظام مابيتقفلش عليه الباب.
    #
    # لو اتشالت منه صلاحية المستخدمين بالغلط، مافيش حد يقدر يرجّعها — الشاشة اللي بترجّعها
    # هي نفسها اللي اتقفلت. الدور ده بيفضل كامل مهما اتضبط، والشاشة مابتديش تعديله أصلاً.
    if role == RoleName.system_admin:
        return capability in ALL_CAPABILITIES
    return capability in effective_capabilities(role)
