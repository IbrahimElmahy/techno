from __future__ import annotations

from src.models.role import RoleName

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
    RoleName.system_admin: set(ALL_CAPABILITIES),
    RoleName.branch_manager: set(_BRANCH_FULL),
    RoleName.purchasing_manager: set(_BRANCH_FULL),
    RoleName.sales_manager: {
        CAP_SALES_READ,
        CAP_CUSTOMER_READ,
        CAP_CUSTOMER_WRITE,
        CAP_BRANCH_READ,
        CAP_GOVERNORATE_READ,
        CAP_TERRITORY_READ,
    },
    RoleName.after_sales_staff: {
        CAP_CUSTOMER_READ,
        CAP_CUSTOMER_WRITE,
        CAP_GOVERNORATE_READ,
        CAP_TERRITORY_READ,
    },
    RoleName.sales_rep: {
        CAP_CUSTOMER_READ,
        CAP_CUSTODY_READ,
        CAP_LEDGER_READ,
    },
}


CAP_CATALOG_READ = "catalog.read"
CAP_CATALOG_WRITE = "catalog.write"
CAP_SUPPLIER_READ = "supplier.read"
CAP_SUPPLIER_WRITE = "supplier.write"
CAP_PURCHASE_WRITE = "purchase.write"
CAP_MANUFACTURE_WRITE = "manufacture.write"
CAP_MANUFACTURE_READ = "manufacture.read"
CAP_SALE_WRITE = "sale.write"
CAP_SALE_EDIT = "sale.edit"
CAP_SALE_DELETE = "sale.delete"
CAP_SALE_BONUS = "sale.bonus"
CAP_SELL_BELOW_PRICE = "sell.below_price"
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
    RoleName.sales_rep: {
        CAP_CATALOG_READ, CAP_SALE_WRITE, CAP_STOCK_READ, CAP_RETURN_WRITE,
        CAP_TRANSFER_INITIATE,
    },
}

for _role, _caps in _SI_BY_ROLE.items():
    ROLE_CAPABILITIES.setdefault(_role, set()).update(_caps)
ALL_CAPABILITIES |= _SI_ALL

_SALE_EDIT_ALL = {CAP_SALE_EDIT, CAP_SALE_DELETE}
for _role in (RoleName.system_admin, RoleName.branch_manager, RoleName.sales_manager, RoleName.purchasing_manager):
    ROLE_CAPABILITIES.setdefault(_role, set()).update(_SALE_EDIT_ALL)
ALL_CAPABILITIES |= _SALE_EDIT_ALL
ROLE_CAPABILITIES.setdefault(RoleName.sales_rep, set()).add(CAP_SALE_EDIT)
for _role in (RoleName.system_admin, RoleName.branch_manager, RoleName.sales_manager,
              RoleName.sales_rep):
    ROLE_CAPABILITIES.setdefault(_role, set()).add(CAP_SALE_BONUS)
ALL_CAPABILITIES.add(CAP_SALE_BONUS)

for _role in (RoleName.system_admin, RoleName.branch_manager, RoleName.sales_manager):
    ROLE_CAPABILITIES.setdefault(_role, set()).add(CAP_SELL_BELOW_PRICE)
ALL_CAPABILITIES.add(CAP_SELL_BELOW_PRICE)

CAP_SELL_BELOW_COST = "sell.below_cost"
ALL_CAPABILITIES.add(CAP_SELL_BELOW_COST)

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

for _role in (RoleName.system_admin, RoleName.after_sales_staff):
    ROLE_CAPABILITIES.setdefault(_role, set()).update(_LOYALTY_ALL)
ALL_CAPABILITIES |= _LOYALTY_ALL

CAP_COUPON_RECEIVE = "coupon.receive"
for _role in (RoleName.system_admin, RoleName.after_sales_staff, RoleName.branch_manager,
              RoleName.sales_rep, RoleName.sales_manager):
    ROLE_CAPABILITIES.setdefault(_role, set()).add(CAP_COUPON_RECEIVE)
ALL_CAPABILITIES.add(CAP_COUPON_RECEIVE)

CAP_COUPON_CUSTODY = "coupon.custody"
for _role in (RoleName.system_admin, RoleName.after_sales_staff, RoleName.branch_manager,
              RoleName.sales_manager):
    ROLE_CAPABILITIES.setdefault(_role, set()).add(CAP_COUPON_CUSTODY)
ALL_CAPABILITIES.add(CAP_COUPON_CUSTODY)

CAP_ACCOUNTING_CHART_READ = "accounting.chart.read"
CAP_ACCOUNTING_CHART_WRITE = "accounting.chart.write"
CAP_ACCOUNTING_JOURNAL_POST = "accounting.journal.post"
CAP_ACCOUNTING_JOURNAL_REVERSE = "accounting.journal.reverse"
CAP_ACCOUNTING_TRIAL_BALANCE_READ = "accounting.trial_balance.read"

_ACCOUNTING_ALL = {
    CAP_ACCOUNTING_CHART_READ, CAP_ACCOUNTING_CHART_WRITE, CAP_ACCOUNTING_JOURNAL_POST,
    CAP_ACCOUNTING_JOURNAL_REVERSE, CAP_ACCOUNTING_TRIAL_BALANCE_READ,
}

for _role in (RoleName.system_admin, RoleName.accountant):
    ROLE_CAPABILITIES.setdefault(_role, set()).update(_ACCOUNTING_ALL)
ALL_CAPABILITIES |= _ACCOUNTING_ALL


CAP_INSPECTION_READ = "inspection.read"
CAP_INSPECTION_WRITE = "inspection.write"

_INSPECTION_ALL = {CAP_INSPECTION_READ, CAP_INSPECTION_WRITE}

for _role in (RoleName.system_admin, RoleName.branch_manager, RoleName.sales_manager,
              RoleName.after_sales_staff, RoleName.sales_rep):
    ROLE_CAPABILITIES.setdefault(_role, set()).update(_INSPECTION_ALL)
ALL_CAPABILITIES |= _INSPECTION_ALL


CAP_VOUCHER_READ = "voucher.read"
CAP_VOUCHER_WRITE = "voucher.write"

_VOUCHER_ALL = {CAP_VOUCHER_READ, CAP_VOUCHER_WRITE}

for _role in (RoleName.system_admin, RoleName.branch_manager, RoleName.accountant):
    ROLE_CAPABILITIES.setdefault(_role, set()).update(_VOUCHER_ALL)
ROLE_CAPABILITIES.setdefault(RoleName.sales_manager, set()).add(CAP_VOUCHER_READ)
ROLE_CAPABILITIES.setdefault(RoleName.sales_rep, set()).update(_VOUCHER_ALL)
ALL_CAPABILITIES |= _VOUCHER_ALL


CAP_HR_READ = "hr.read"
CAP_HR_WRITE = "hr.write"

CAP_PAYROLL_READ = "payroll.read"
CAP_PAYROLL_POST = "payroll.post"

CAP_SALARY_VIEW = "salary.view"

_HR_ALL = {CAP_HR_READ, CAP_HR_WRITE}
_PAYROLL_ALL = {CAP_PAYROLL_READ, CAP_PAYROLL_POST, CAP_SALARY_VIEW}

for _role in (RoleName.system_admin, RoleName.branch_manager):
    ROLE_CAPABILITIES.setdefault(_role, set()).update(_HR_ALL)
for _role in (RoleName.system_admin, RoleName.accountant):
    ROLE_CAPABILITIES.setdefault(_role, set()).update(_PAYROLL_ALL)
ROLE_CAPABILITIES.setdefault(RoleName.branch_manager, set()).add(CAP_PAYROLL_READ)
ROLE_CAPABILITIES.setdefault(RoleName.accountant, set()).add(CAP_HR_READ)

ALL_CAPABILITIES |= _HR_ALL | _PAYROLL_ALL

CAP_FLEET_READ = "fleet.read"
CAP_FLEET_WRITE = "fleet.write"
_FLEET_ALL = {CAP_FLEET_READ, CAP_FLEET_WRITE}
ROLE_CAPABILITIES.setdefault(RoleName.system_admin, set()).update(_FLEET_ALL)
ALL_CAPABILITIES |= _FLEET_ALL

CAP_STATS_VIEW = "stats.view"
ALL_CAPABILITIES |= {CAP_STATS_VIEW}

APP_CAPABILITIES: dict[str, str] = {
    "app.sale": "التطبيق: فاتورة بيع",
    "app.bonus": "التطبيق: فاتورة بونص",
    "app.my_invoices": "التطبيق: فواتيري",
    "app.collect": "التطبيق: تحصيل من عميل",
    "app.my_collections": "التطبيق: تحصيلاتي",
    "app.my_stock": "التطبيق: بضاعتي",
    "app.price_sheet": "التطبيق: كشف تسعير",
    "app.transfers": "التطبيق: طلبات التحويل",
    "app.debts": "التطبيق: كشف المديونيات",
    "app.customer_account": "التطبيق: حساب عميل",
    "app.day_summary": "التطبيق: ملخّص اليوم",
    "app.visits": "التطبيق: الزيارات",
    "app.coupon_receive": "التطبيق: استلام كوبونات",
    "app.coupon_review": "التطبيق: مراجعة الكوبونات",
    "app.visit_review": "التطبيق: مراجعة الزيارات",
    "app.supervisor": "التطبيق: متابعة المناديب (مشرف)",
}
CAP_APP_SUPERVISOR = "app.supervisor"
REP_APP_CAPABILITIES: set[str] = set(APP_CAPABILITIES) - {CAP_APP_SUPERVISOR}
ALL_CAPABILITIES |= set(APP_CAPABILITIES)
ROLE_CAPABILITIES.setdefault(RoleName.sales_rep, set()).update(REP_APP_CAPABILITIES)

ROLE_CAPABILITIES[RoleName.owner] = set(ALL_CAPABILITIES)
ROLE_CAPABILITIES.setdefault(RoleName.system_admin, set()).add(CAP_STATS_VIEW)


ROLE_CAPABILITIES[RoleName.viewer] = {
    cap for cap in ALL_CAPABILITIES if cap.endswith(".read")
}


_NOT_FOR_BRANCH_MANAGER = {CAP_BRANCH_WRITE, CAP_LOYALTY_SETTINGS_WRITE, CAP_STATS_VIEW,
                           CAP_SELL_BELOW_COST, CAP_APP_SUPERVISOR}
ROLE_CAPABILITIES[RoleName.branch_manager] = ALL_CAPABILITIES - _NOT_FOR_BRANCH_MANAGER


_READ_CAPS = {c for c in ALL_CAPABILITIES if c.endswith(".read")}
for _role in (RoleName.branch_manager, RoleName.purchasing_manager, RoleName.sales_manager,
              RoleName.accountant, RoleName.after_sales_staff, RoleName.viewer):
    ROLE_CAPABILITIES.setdefault(_role, set()).update(_READ_CAPS)

ROLE_CAPABILITIES.setdefault(RoleName.sales_rep, set()).add(CAP_SALES_READ)

ROLE_CAPABILITIES[RoleName.viewer] = set(_READ_CAPS)

ROLE_CAPABILITIES[RoleName.accountant].update(
    {CAP_LEDGER_POST, CAP_LEDGER_REVERSE, CAP_SALARY_VIEW})

ROLE_CAPABILITIES[RoleName.owner] = set(ALL_CAPABILITIES)

for _role in RoleName:
    if _role == RoleName.rep_supervisor:
        continue
    ROLE_CAPABILITIES.setdefault(_role, set()).update(REP_APP_CAPABILITIES)

ROLE_CAPABILITIES[RoleName.rep_supervisor] = {CAP_APP_SUPERVISOR, CAP_SALES_READ}


_OVERRIDES: dict[RoleName, set[str]] = {}

_ALWAYS_GRANTED: dict[RoleName, set[str]] = {
    RoleName.after_sales_staff: {"app.price_sheet"},
}
ROLE_CAPABILITIES.setdefault(RoleName.after_sales_staff, set()).add("app.price_sheet")


def refresh_overrides(db) -> None:
    from src.models.permission import RoleCapability

    rows = db.query(RoleCapability.role, RoleCapability.capability).all()
    fresh: dict[RoleName, set[str]] = {}
    for role, cap in rows:
        fresh.setdefault(role, set()).add(cap)
    for role, caps in _ALWAYS_GRANTED.items():
        if role in fresh:
            fresh[role] |= caps
    _OVERRIDES.clear()
    _OVERRIDES.update(fresh)


def effective_capabilities(role: RoleName) -> set[str]:
    if role in _OVERRIDES:
        return _OVERRIDES[role]
    return ROLE_CAPABILITIES.get(role, set())


def role_has_capability(role: RoleName, capability: str) -> bool:
    if role == RoleName.system_admin:
        return capability in ALL_CAPABILITIES
    return capability in effective_capabilities(role)
