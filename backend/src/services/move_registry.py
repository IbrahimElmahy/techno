"""نوع المستند المحاسبي بتاع كل قيد — المرحلة ٢ من إعادة الهيكلة على موديل أودو.

الجزء التاني من نفس السؤال اللي `journal_registry` بيجاوب عليه. هناك: «القيد ده
يتعرض في أنهي دفتر ويتّرقّم إزاي». هنا: «القيد ده مستند إيه، وعلى مين».

الخريطة مكتوبة في مكان واحد لنفس السبب: الموديول اللي بينسى يقول نوعه مايبقاش قيده
بلا نوع — بيقع على `entry`، وهو نفس اللي أودو بيعمله مع المدفوعات والقيود العادية.
"""
from __future__ import annotations

from src.models.ledger import MoveType, PartnerKind

# نوع القيد → نوع المستند. اللي مش هنا `entry` — والأغلبية كده فعلاً: السند والشيك
# والراتب والإهلاك في أودو كلهم `entry`، مش أنواع لوحدهم.
_MOVE_TYPES: dict[str, MoveType] = {
    "sale": MoveType.out_invoice,
    "sale_return": MoveType.out_refund,
    "purchase": MoveType.in_invoice,
    "purchase_return": MoveType.in_refund,
}

# نوع القيد → نوع الشريك المتوقّع. بيتستعمل في التحقق وفي سكربت النقل: القيد اللي
# نوعه بيقول «على عميل» وجاي من غير شريك بيتعدّ ويتقال، مش بيعدّي في صمت.
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
    """نوع المستند بتاع نوع القيد ده."""
    return _MOVE_TYPES.get(entry_type, MoveType.entry)


def expected_partner_kind(entry_type: str) -> PartnerKind | None:
    """نوع الشريك اللي المفروض القيد ده يبقى عليه — أو `None` لو مالوش شريك بطبعه."""
    return _PARTNER_KINDS.get(entry_type)


def reversed_move_type(move_type: str | None) -> MoveType:
    """نوع القيد العكسي. عكس فاتورة البيع مردود بيع — زي إشعار الدائن في أودو.

    من غير الانعكاس ده، عكس فاتورة كان هيتعدّ فاتورة تانية في أي تقرير بيعدّ
    بالنوع، فمبيعات الشهر تطلع ضعف اللي حصل.
    """
    mirror = {
        MoveType.out_invoice.value: MoveType.out_refund,
        MoveType.out_refund.value: MoveType.out_invoice,
        MoveType.in_invoice.value: MoveType.in_refund,
        MoveType.in_refund.value: MoveType.in_invoice,
    }
    return mirror.get(move_type or "", MoveType.entry)


def is_invoice(move_type: str | None) -> bool:
    """فاتورة ولا مردود (مش قيد عادي) — اللي بيتقفل عليه دفع في المرحلة ٣."""
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
    MoveType.in_invoice.value: "فاتورة شرا",
    MoveType.in_refund.value: "مردود شرا",
}

PARTNER_KIND_LABEL: dict[str, str] = {
    PartnerKind.customer.value: "عميل",
    PartnerKind.supplier.value: "مورد",
    PartnerKind.employee.value: "موظف",
}
