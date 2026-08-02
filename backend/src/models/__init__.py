"""Model package — import all models so metadata is fully populated."""
from src.models.audit import AuditLogEntry
from src.models.bom import Bom, BomComponent, BomResource  # noqa: E402
from src.models.catalog import Item, ItemPrice, ItemSerial, ItemUnit
from src.models.contact import ContactPhone  # noqa: E402

# Cost Centers (006) — analytical dimension.
from src.models.cost_center import CostCenter  # noqa: E402
from src.models.customer import Customer, CustomerAccount

# Site inspections / معاينات (015-inspections-mobile).
from src.models.inspection import Inspection, InspectionItem  # noqa: E402
from src.models.inspection_item_type import InspectionItemType  # noqa: E402
from src.models.ledger import Account, LedgerEntry, LedgerLine

# Settings → configurable dropdown lists (013).
from src.models.lookup import LookupOption  # noqa: E402

# After-Sales Loyalty (003) models.
from src.models.loyalty import (  # noqa: E402
    Coupon,
    CouponRedemption,
    CouponType,
    PointConversion,
    PointRecord,
    ProductPointValue,
)
from src.models.manufacturing import (  # noqa: E402
    ManufacturingOp,
    ManufacturingOrder,
    ManufacturingOrderConsumption,
    ManufacturingOrderResource,
)
from src.models.org import Branch, Governorate, HeadOffice, Territory
from src.models.purchasing import (  # noqa: E402
    PurchaseInvoice,
    PurchaseInvoiceLine,
    PurchaseReturn,
    PurchaseReturnLine,
)
from src.models.role import Role
from src.models.sales import (  # noqa: E402
    SalesInvoice,
    SalesInvoiceLine,
    SalesReturn,
    SalesReturnLine,
    SalesSetting,
)
from src.models.sales_expense import SalesInvoiceExpense  # noqa: E402
from src.models.stock import StockLocator, StockMovement, StockSetting  # noqa: E402
from src.models.stock_permit import StockPermit, StockPermitLine  # noqa: E402

# Sales & Inventory (002) models — imported for metadata; added per phase.
from src.models.supplier import Supplier, SupplierAccount  # noqa: E402
from src.models.trade_order import TradeOrder, TradeOrderLine  # noqa: E402
from src.models.transfer import StockTransfer  # noqa: E402
from src.models.user import User
from src.models.warehouse import Custody, Warehouse
from src.models.cheque import Cheque  # noqa: E402
from src.models.commission import CommissionRule  # noqa: E402
from src.models.treasury import PeriodLock, Treasury  # noqa: E402
from src.models.voucher import Voucher  # noqa: E402
from src.models.coupon_receipt import CouponReceipt, CouponReceiptLine  # noqa: E402
from src.models.account_routing import AccountRouting  # noqa: E402
from src.models.employee import Employee, JobTitle  # noqa: E402
from src.models.fixed_asset import DepreciationRecord, FixedAsset  # noqa: E402
from src.models.wastage import WastageDocument  # noqa: E402

__all__ = [
    "AccountRouting",
    "AuditLogEntry", "Item", "Customer", "CustomerAccount", "Account", "LedgerEntry",
    "LedgerLine", "Branch", "Governorate", "HeadOffice", "Territory", "Role", "User",
    "Custody", "Warehouse", "Supplier", "SupplierAccount", "StockLocator", "StockMovement",
    "PurchaseInvoice", "PurchaseInvoiceLine", "PurchaseReturn", "PurchaseReturnLine",
    "SalesInvoice", "SalesInvoiceLine", "SalesReturn", "SalesReturnLine", "SalesSetting",
    "ManufacturingOp", "ManufacturingOrder", "ManufacturingOrderConsumption",
    "ManufacturingOrderResource", "Bom", "BomComponent", "BomResource", "StockTransfer",
    "ProductPointValue", "PointRecord", "CouponType", "PointConversion", "Coupon",
    "CouponRedemption", "CostCenter", "ItemPrice", "ItemUnit", "ItemSerial",
    "LookupOption", "WastageDocument", "ContactPhone", "Inspection", "InspectionItem",
    "Voucher", "Treasury", "PeriodLock", "Cheque", "CommissionRule",
    "InspectionItemType", "StockSetting", "StockPermit", "StockPermitLine", "FixedAsset", "DepreciationRecord", "Employee", "JobTitle", "CouponReceipt", "CouponReceiptLine", "TradeOrder", "TradeOrderLine", "SalesInvoiceExpense",
]
