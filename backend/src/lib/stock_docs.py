from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class DocSpec:
    name: str
    label: str
    aliases: tuple[str, ...] = ()
    dated: tuple[str, str, str] | None = None


DOCS: tuple[DocSpec, ...] = (
    DocSpec("sales_invoice", "فاتورة بيع", ("sale",),
            ("src.models.sales", "SalesInvoice", "invoice_date")),
    DocSpec("sales_return", "مرتجع بيع", ("sale_return",),
            ("src.models.sales", "SalesReturn", "return_date")),
    DocSpec("purchase_invoice", "فاتورة شراء", ("purchase",),
            ("src.models.purchasing", "PurchaseInvoice", "purchase_date")),
    DocSpec("purchase_return", "مرتجع شراء", (),
            ("src.models.purchasing", "PurchaseReturn", "return_date")),
    DocSpec("stock_transfer", "إذن تحويل", ("transfer",),
            ("src.models.transfer", "StockTransfer", "transfer_date")),
    DocSpec("stock_permit", "إذن مخزن", ("permit",),
            ("src.models.stock_permit", "StockPermit", "permit_date")),
    DocSpec("stock_count", "جرد", (),
            ("src.models.stock_count", "StockCount", "count_date")),
    DocSpec("manufacturing_order", "أمر تصنيع", ("manufacturing",),
            ("src.models.manufacturing", "ManufacturingOrder", "production_date")),
    DocSpec("production_order", "أمر تشغيل", (),
            ("src.models.manufacturing", "ProductionOrder", "production_date")),
    DocSpec("inspection", "معاينة", (),
            ("src.models.inspection", "Inspection", "inspection_date")),
    DocSpec("a5_opening", "رصيد أول المدة", ("opening",)),
    DocSpec("a5_opening_fix", "تصحيح رصيد أول المدة", ()),
    DocSpec("coupon", "كوبون", ()),
    DocSpec("batch_receive", "استلام دفعة", ()),
    DocSpec("import", "استيراد", ()),
    DocSpec("wastage", "هالك", ()),
    DocSpec("serial_receive", "استلام أرقام تسلسلية", ()),
    DocSpec("sale_return_reversal", "عكس مرتجع بيع", ()),
    DocSpec("purchase_return_reversal", "عكس مرتجع شراء", ()),
)


@dataclass(frozen=True)
class MoveSpec:
    name: str
    label: str
    aliases: tuple[str, ...] = field(default=())


MOVES: tuple[MoveSpec, ...] = (
    MoveSpec("sale", "بيع", ("sale_out",)),
    MoveSpec("sales_return", "مرتجع بيع", ("sale_return_in",)),
    MoveSpec("purchase", "شراء", ("purchase_in",)),
    MoveSpec("purchase_return", "مرتجع شراء", ("purchase_return_out",)),
    MoveSpec("transfer_in", "تحويل وارد", ()),
    MoveSpec("transfer_out", "تحويل صادر", ()),
    MoveSpec("opening", "بضاعة أول المدة", ("opening_stock", "opening_in")),
    MoveSpec("permit_in", "إذن إضافة", ()),
    MoveSpec("permit_out", "إذن صرف", ()),
    MoveSpec("permit", "إذن مخزن", ()),
    MoveSpec("count_adjust_in", "تسوية جرد (زيادة)", ()),
    MoveSpec("count_adjust_out", "تسوية جرد (عجز)", ()),
    MoveSpec("production_in", "إنتاج", ()),
    MoveSpec("consumption_out", "استهلاك", ()),
    MoveSpec("waste_out", "هالك", ()),
    MoveSpec("inspection_out", "معاينة", ()),
    MoveSpec("loyalty_gift_out", "هدية نقاط", ()),
    MoveSpec("serial_receive_in", "استلام أرقام تسلسلية", ()),
    MoveSpec("batch_in", "استلام دفعة", ()),
    MoveSpec("sale_return_reversal", "عكس مرتجع بيع", ()),
    MoveSpec("purchase_return_reversal", "عكس مرتجع شراء", ()),
)


_SOURCE_MOVE_LABELS: dict[str, str] = {
    "a5_opening_fix": "تسوية رصيد افتتاحي",
}


class StockDoc:
    SALE = "sales_invoice"
    SALE_RETURN = "sales_return"
    PURCHASE = "purchase_invoice"
    PURCHASE_RETURN = "purchase_return"
    TRANSFER = "stock_transfer"
    PERMIT = "stock_permit"
    COUNT = "stock_count"
    MANUFACTURING = "manufacturing_order"
    INSPECTION = "inspection"
    OPENING = "a5_opening"
    OPENING_FIX = "a5_opening_fix"


def _index(specs) -> tuple[dict[str, str], dict[str, tuple[str, ...]], dict[str, str]]:
    canon: dict[str, str] = {}
    every: dict[str, tuple[str, ...]] = {}
    labels: dict[str, str] = {}
    for s in specs:
        all_names = (s.name, *s.aliases)
        for n in all_names:
            canon[n] = s.name
            every[n] = all_names
            labels[n] = s.label
    return canon, every, labels


_REVERSE = "reverse_"

_DOC_CANON, _DOC_NAMES, _DOC_LABELS = _index(DOCS)
_MOVE_CANON, _MOVE_NAMES, _MOVE_LABELS = _index(MOVES)
_DATED = {s.name: s.dated for s in DOCS if s.dated}
for _s in DOCS:
    if _s.dated:
        for _a in _s.aliases:
            _DATED[_a] = _s.dated


def canonical(value: str | None, *, kind: str = "doc") -> str | None:
    if value is None:
        return None
    table = _MOVE_CANON if kind == "movement" else _DOC_CANON
    hit = table.get(value)
    if hit is not None:
        return hit
    if value.startswith(_REVERSE):
        base = table.get(value[len(_REVERSE):])
        if base is not None:
            return _REVERSE + base
    return None


def names(source_doc_type: str, *, kind: str = "doc") -> tuple[str, ...]:
    table = _MOVE_NAMES if kind == "movement" else _DOC_NAMES
    hit = table.get(source_doc_type)
    if hit is not None:
        return hit
    if source_doc_type.startswith(_REVERSE):
        base = table.get(source_doc_type[len(_REVERSE):])
        if base is not None:
            return tuple(_REVERSE + n for n in base)
    return (source_doc_type,)


def label(value: str | None, *, kind: str = "doc") -> str:
    if value is None:
        return "—"
    table = _MOVE_LABELS if kind == "movement" else _DOC_LABELS
    hit = table.get(value)
    if hit is not None:
        return hit
    if value.startswith(_REVERSE):
        base = table.get(value[len(_REVERSE):])
        if base is not None:
            return f"عكس {base}"
    return value


def movement_types() -> list[dict[str, str]]:
    out = [{"value": s.name, "label": s.label} for s in MOVES]
    out += [{"value": _REVERSE + s.name, "label": f"عكس {s.label}"}
            for s in MOVES if not s.name.endswith("_reversal")]
    return out


def doc_types() -> list[dict[str, str]]:
    return [{"value": s.name, "label": s.label} for s in DOCS]


def date_of(db, source_doc_type: str | None, source_doc_id: int | None):
    if not source_doc_type or not source_doc_id:
        return None
    spec = _DATED.get(source_doc_type)
    if spec is None:
        return None
    module_name, class_name, field_name = spec
    try:
        import importlib

        model = getattr(importlib.import_module(module_name), class_name)
        row = db.get(model, source_doc_id)
        if row is None:
            return None
        value = getattr(row, field_name, None)
        return getattr(value, "date", lambda: value)() if hasattr(value, "date") else value
    except Exception:  # noqa: BLE001
        return None


def movement_label(movement_type: str | None, source_doc_type: str | None = None) -> str:
    if source_doc_type and source_doc_type in _SOURCE_MOVE_LABELS:
        return _SOURCE_MOVE_LABELS[source_doc_type]
    return label(movement_type, kind="movement")
