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
CAP_SALE_WRITE = "sale.write"
CAP_SELL_BELOW_PRICE = "sell.below_price"  # (007) charge below the resolved tier price
CAP_TRANSFER_INITIATE = "transfer.initiate"
CAP_TRANSFER_APPROVE = "transfer.approve"
CAP_STOCK_READ = "stock.read"
CAP_RETURN_WRITE = "return.write"
CAP_SETTINGS_WRITE = "settings.write"

_SI_ALL = {
    CAP_CATALOG_READ, CAP_CATALOG_WRITE, CAP_SUPPLIER_READ, CAP_SUPPLIER_WRITE,
    CAP_PURCHASE_WRITE, CAP_MANUFACTURE_WRITE, CAP_SALE_WRITE, CAP_TRANSFER_INITIATE,
    CAP_TRANSFER_APPROVE, CAP_STOCK_READ, CAP_RETURN_WRITE, CAP_SETTINGS_WRITE,
}

# Per-role grants (FR-026–028; clarified role mapping). NOT folded into _BRANCH_FULL so that
# branch_manager and purchasing_manager can differ (e.g., only PM purchases; only BM approves/sells).
_SI_BY_ROLE: dict[RoleName, set[str]] = {
    RoleName.system_admin: set(_SI_ALL),
    RoleName.branch_manager: {
        CAP_CATALOG_READ, CAP_CATALOG_WRITE, CAP_SUPPLIER_READ, CAP_SUPPLIER_WRITE,
        CAP_MANUFACTURE_WRITE, CAP_SALE_WRITE, CAP_TRANSFER_INITIATE, CAP_TRANSFER_APPROVE,
        CAP_STOCK_READ, CAP_RETURN_WRITE, CAP_SETTINGS_WRITE,
    },
    RoleName.purchasing_manager: {
        CAP_CATALOG_READ, CAP_CATALOG_WRITE, CAP_SUPPLIER_READ, CAP_SUPPLIER_WRITE,
        CAP_PURCHASE_WRITE, CAP_MANUFACTURE_WRITE, CAP_TRANSFER_INITIATE,
        CAP_STOCK_READ, CAP_RETURN_WRITE,
    },
    RoleName.sales_manager: {
        CAP_CATALOG_READ, CAP_SUPPLIER_READ, CAP_SALE_WRITE, CAP_TRANSFER_INITIATE,
        CAP_STOCK_READ, CAP_RETURN_WRITE,
    },
    RoleName.after_sales_staff: {CAP_CATALOG_READ, CAP_STOCK_READ},
    RoleName.sales_rep: {CAP_CATALOG_READ, CAP_SALE_WRITE, CAP_STOCK_READ, CAP_RETURN_WRITE},
}

for _role, _caps in _SI_BY_ROLE.items():
    ROLE_CAPABILITIES.setdefault(_role, set()).update(_caps)
ALL_CAPABILITIES |= _SI_ALL

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


def role_has_capability(role: RoleName, capability: str) -> bool:
    """Deny-by-default: True only if explicitly granted."""
    return capability in ROLE_CAPABILITIES.get(role, set())
