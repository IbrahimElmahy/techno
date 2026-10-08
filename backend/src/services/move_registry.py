from __future__ import annotations

from src.models.ledger import MoveType, PartnerKind

_MOVE_TYPES: dict[str, MoveType] = {
    "sale": MoveType.out_invoice,
    "sales_invoice": MoveType.out_invoice,
    "sale_return": MoveType.out_refund,
    "sales_return": MoveType.out_refund,
    "purchase": MoveType.in_invoice,
    "purchase_invoice": MoveType.in_invoice,
    "purchase_return": MoveType.in_refund,
}

_PARTNER_KINDS: dict[str, PartnerKind] = {
    "sale": PartnerKind.customer,
    "sale_return": PartnerKind.customer,
    "purchase": PartnerKind.supplier,
    "purchase_return": PartnerKind.supplier,
    "payroll_accrual": PartnerKind.employee,
    "payroll_payment": PartnerKind.employee,
    "employee_advance": PartnerKind.employee,
}


def move_type_for(entry_type: str) -> MoveType:
    return _MOVE_TYPES.get(entry_type, MoveType.entry)


def expected_partner_kind(entry_type: str) -> PartnerKind | None:
    return _PARTNER_KINDS.get(entry_type)


def reversed_move_type(move_type: str | None) -> MoveType:
    mirror = {
        MoveType.out_invoice.value: MoveType.out_refund,
        MoveType.out_refund.value: MoveType.out_invoice,
        MoveType.in_invoice.value: MoveType.in_refund,
        MoveType.in_refund.value: MoveType.in_invoice,
    }
    return mirror.get(move_type or "", MoveType.entry)


def is_invoice(move_type: str | None) -> bool:
    return move_type in (
        MoveType.out_invoice.value,
        MoveType.out_refund.value,
        MoveType.in_invoice.value,
        MoveType.in_refund.value,
    )


MOVE_TYPE_LABEL: dict[str, str] = {
    MoveType.entry.value: "قيد",
    MoveType.out_invoice.value: "فاتورة بيع",
    MoveType.out_refund.value: "مردود بيع",
    MoveType.in_invoice.value: "فاتورة شراء",
    MoveType.in_refund.value: "مردود شراء",
}

PARTNER_KIND_LABEL: dict[str, str] = {
    PartnerKind.customer.value: "عميل",
    PartnerKind.supplier.value: "مورد",
    PartnerKind.employee.value: "موظف",
}
