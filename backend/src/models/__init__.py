"""Model package — import all models so metadata is fully populated."""
from src.models.audit import AuditLogEntry
from src.models.bom import Bom, BomComponent  # noqa: E402
from src.models.catalog import Item, ItemBarcode, ItemPrice, ItemSerial, ItemUnit

# Cost Centers (006) — analytical dimension.
from src.models.cost_center import CostCenter  # noqa: E402

# Settings → configurable dropdown lists (013).
from src.models.lookup import LookupOption  # noqa: E402
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account, LedgerEntry, LedgerLine

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
from src.models.stock import StockLocator, StockMovement  # noqa: E402

# Sales & Inventory (002) models — imported for metadata; added per phase.
from src.models.supplier import Supplier, SupplierAccount  # noqa: E402
from src.models.transfer import StockTransfer  # noqa: E402
from src.models.user import User
from src.models.warehouse import Custody, Warehouse

__all__ = [
    "AuditLogEntry", "Item", "Customer", "CustomerAccount", "Account", "LedgerEntry",
    "LedgerLine", "Branch", "Governorate", "HeadOffice", "Territory", "Role", "User",
    "Custody", "Warehouse", "Supplier", "SupplierAccount", "StockLocator", "StockMovement",
    "PurchaseInvoice", "PurchaseInvoiceLine", "PurchaseReturn", "PurchaseReturnLine",
    "SalesInvoice", "SalesInvoiceLine", "SalesReturn", "SalesReturnLine", "SalesSetting",
    "ManufacturingOp", "ManufacturingOrder", "ManufacturingOrderConsumption",
    "Bom", "BomComponent", "StockTransfer",
    "ProductPointValue", "PointRecord", "CouponType", "PointConversion", "Coupon",
    "CouponRedemption", "CostCenter", "ItemPrice", "ItemUnit", "ItemSerial", "ItemBarcode",
    "LookupOption",
]
