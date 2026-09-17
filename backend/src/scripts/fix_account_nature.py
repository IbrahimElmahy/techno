# -*- coding: utf-8 -*-
"""الحساب اللي مالوش طبيعة بيسقط من الميزانية في صمت.

الميزانية بتصنّف كل حساب من `nature`، ولو مالوش بتقع على خريطة النوع
(`_NATURE_BY_TYPE`). والنوع `user_defined` **مش في الخريطة** — لأنه بالتعريف حساب
العميل عمله بنفسه. فالحساب اللي نوعه `user_defined` و`nature` بتاعته فاضية بيتسقّط
من الأصول والالتزامات وحقوق الملكية كلهم، ورصيده بيختفي من الوجهين.

وساعتها الميزانية مابتوزنش — والدفتر موزون. اتقاس على قاعدة العميل:

    الأصول  23,518,754.80
    الالتزامات 1,803,502.65 + حقوق 20,274,595.65 + ربح 1,538,257.46 = 23,616,355.76
    الفرق 97,600.96 = مجموع أربع حسابات مالهمش طبيعة، بالمليم

## الطبيعة بتتاخد من مكان الحساب مش بالتخمين

الأربعة دول حسابات ذمم عملاء (مربوطين في `customer_account`)، فطبيعتهم **أصل**.
والسكريبت بيمشي بنفس المنطق لكل حساب: مربوط بعميل ⇒ أصل، بمورد ⇒ التزام. واللي مش
مربوط بحاجة بيتساب ويتقال عليه — تصنيفه قرار محاسبي مش استنتاج.

    python -m src.scripts.fix_account_nature            # عرض بس
    python -m src.scripts.fix_account_nature --apply    # بيكتب
"""
from __future__ import annotations

import argparse
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.core.db import SessionLocal
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account, AccountNature, Direction, LedgerLine
from src.models.supplier import Supplier, SupplierAccount
from src.services.financial_reports_service import effective_nature


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db: Session = SessionLocal()
    try:
        signed = func.sum(case((LedgerLine.direction == Direction.debit, LedgerLine.amount),
                               else_=-LedgerLine.amount))
        balances = dict(db.execute(
            select(LedgerLine.account_id, signed).group_by(LedgerLine.account_id)).all())
        cust = {a for (a,) in db.execute(select(CustomerAccount.account_id)).all()}
        sup = {a for (a,) in db.execute(select(SupplierAccount.account_id)).all()}
        # الحساب اللي مش مربوط بجدول الربط لكن اسمه اسم عميل موجود — ده حساب ذمم
        # اتعمل بره الشاشة (سكريبت استرجاع من a5) ومحدّش ربطه. الاسم المطابق دليل
        # كافي على الطبيعة (**أصل**)، مش كافي على الربط — الربط قرار تاني.
        cust_names = {n for (n,) in db.execute(select(Customer.name)).all() if n}
        sup_names = {n for (n,) in db.execute(select(Supplier.name)).all() if n}

        rows, unknown = [], []
        for acc in db.scalars(select(Account)).all():
            if effective_nature(acc) is not None:
                continue
            bal = Decimal(str(balances.get(acc.id, 0) or 0))
            if acc.id in cust:
                rows.append((acc, AccountNature.asset, "مربوط بعميل", bal))
            elif acc.id in sup:
                rows.append((acc, AccountNature.liability, "مربوط بمورد", bal))
            elif acc.name and acc.name in cust_names:
                rows.append((acc, AccountNature.asset, "اسمه اسم عميل موجود", bal))
            elif acc.name and acc.name in sup_names:
                rows.append((acc, AccountNature.liability, "اسمه اسم مورد موجود", bal))
            elif abs(bal) > Decimal("0.005"):
                unknown.append((acc, bal))

        print(f"{'id':>6} {'الاسم':<28} {'الرصيد':>14} {'الطبيعة':<10} السبب")
        for acc, nat, why, bal in sorted(rows, key=lambda r: -abs(r[3])):
            print(f"{acc.id:>6} {str(acc.name)[:28]:<28} {bal:>14,.2f} {nat.value:<10} {why}")
        print()
        print(f"هيتصلّح: {len(rows)} حساب | إجمالي أرصدتهم "
              f"{sum(r[3] for r in rows):,.2f}")
        if unknown:
            print()
            print(f"⚠ مالهمش طبيعة ومش مربوطين بعميل ولا مورد — محتاجين تصنيف بإيدك ({len(unknown)}):")
            for acc, bal in unknown:
                print(f"   #{acc.id} {acc.code} {acc.name} = {bal:,.2f}")

        if not args.apply:
            print()
            print("عرض بس — للكتابة زوّد --apply")
            return

        for acc, nat, _why, _bal in rows:
            acc.nature = nat
        db.commit()
        print()
        print(f"اتكتب: {len(rows)} حساب")

        left = [a for a in db.scalars(select(Account)).all()
                if effective_nature(a) is None
                and abs(Decimal(str(balances.get(a.id, 0) or 0))) > Decimal("0.005")]
        print(f"الباقي من غير طبيعة وعليه رصيد: {len(left)}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
