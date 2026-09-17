"""حساب المورد — والمورد اللي مالوش، بيتفتحله وقت الحاجة.

الشرا كان بيقف على «المورد ده مالوش حساب دائنين» وبيرمي المستند كله. والبيع في نفس
الموقف بيتصرف: `customer_service.require_account` بيفتح حساب العميل في اللحظة اللي
محتاجينه فيها ويكمّل. الفرق ده مكانش قرار — كان سهو، والنتيجة إن اللي قدامه فاتورة
مورد مايقدرش يعمل بيها حاجة.

**والمشكلة مش نظرية:** في داتا العميل طلع موردين مالهمش حساب — و٣ قيود في الدفتر
اتكتبوا بطرف واحد عشان الاستيراد لقى سطر على حساب مورد مش موجود عنده فرماه. الميزان
كان مختلّ بسببهم.

الحساب اللي بيتفتح هنا **مطابق للي `create_supplier` بيفتحه** — نفس النوع ونفس
الربط ونفس `owner_ref`. ومافيش `commit`: الـflush على نفس الـsession بتاعة المستند،
فلو المستند وقع الحساب بيترجع معاه ومايفضلش حساب فاضي ورا.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.ledger import Account, AccountType, Direction
from src.models.supplier import Supplier, SupplierAccount


class SupplierError(Exception):
    pass


def account_of(db: Session, supplier_id: int) -> SupplierAccount | None:
    """حساب المورد لو موجود — من غير ما يفتح حاجة."""
    return db.scalar(
        select(SupplierAccount).where(SupplierAccount.supplier_id == supplier_id)
    )


def require_account(db: Session, supplier_id: int) -> SupplierAccount:
    """حساب الدائنين بتاع المورد — والمورد اللي مالوش، بيتفتحله دلوقتي.

    بيرفض في حالة واحدة بس: المورد نفسه مش موجود. وساعتها المشكلة مش في الحساب.
    """
    existing = account_of(db, supplier_id)
    if existing is not None:
        return existing

    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise SupplierError("المورد مش موجود.")

    acc = Account(account_type=AccountType.supplier_payable, normal_side=Direction.credit,
                  branch_id=getattr(supplier, "branch_id", None))
    db.add(acc)
    db.flush()
    link = SupplierAccount(supplier_id=supplier_id, account_id=acc.id)
    db.add(link)
    db.flush()
    # `owner_ref` بيشاور على صف الربط مش على المورد — نفس اللي `create_supplier` بيعمله.
    acc.owner_ref = link.id
    db.flush()
    return link
