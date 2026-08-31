"""مخزن المندوب — المكان الواحد اللي بيبيع منه وبيقرا رصيده.

النظام بيمسك بضاعة المندوب بطريقتين على حسب إعداد كل شركة:

* **عهدة** (`custody`) باسمه — ليها حساب في الدفاتر وكشف حساب مستقل.
* **مخزن** متسجّل على كارت الموظف (`employee.warehouse_id`) — «عربية السواق» زي ما موديل
  الموظف بيسمّيها.

الاتنين موجودين في النظام من زمان، لكن البيع كان بيصرّ على العهدة وحدها. النتيجة إن
الشركة اللي بتجهّز مناديبها بمخازن كان مندوبها **مايقدرش يبيع خالص**: السيرفر بيرفض
بـ«Must sell from your own custody» وهو مالوش عهدة أصلاً.

الملف ده هو الإجابة الواحدة على السؤال «المندوب ده بيبيع منين»، عشان البيع وقراءة الرصيد
وحزمة التطبيق يقولوا نفس الحاجة. تلات نسخ من نفس القاعدة في تلات ملفات هي إزاي واحدة منهم
تفضل قديمة من غير ما حد ياخد باله.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.employee import Employee
from src.models.stock import LocationKind
from src.models.warehouse import Custody


def rep_store(db: Session, rep_user_id: int) -> tuple[LocationKind, int] | None:
    """مكان بضاعة المندوب: **المخزن المتسجّل عليه الأول**، وإلا عهدته، وإلا `None`.

    الترتيب ده مش تفصيلة. **العهدة والمخزن مش نفس الحاجة، ومش بديلين:**

    * `employee.warehouse_id` جملة صريحة اتكتبت بإيد حد: «بضاعة المندوب ده في المخزن ده».
    * `Custody` بتمسك **فلوسه** — حساب في الدفاتر بيتقيّد فيه اللي حصّله (`resolve_cash_account`).
      وممكن تكون موجودة لسبب مالي بحت من غير ما يكون فيها بضاعة.

    فالمندوب اللي عنده الاتنين — وده الوضع الطبيعي — بضاعته في مخزنه وفلوسه في عهدته. لو
    العهدة كسبت في الترتيب، المندوب ده كان هيتقال له «بيع من عهدتك» وهي فاضية والبضاعة
    في مخزنه، وهو واقف جنبها.

    واللي مالوش مخزن مسجّل بتفضل عهدته هي مكانه — النظام كان ماشي كده من الأول، والشركة
    اللي مناديبها على عهد مايتغيّرش عندها حاجة.
    """
    emp = db.scalar(select(Employee).where(Employee.user_id == rep_user_id))
    if emp is not None and emp.warehouse_id is not None:
        return (LocationKind.warehouse, emp.warehouse_id)
    # المندوب بقى له أكتر من عهدة (صندوق أبيض وصندوق بولي جنب العهدة القديمة)، والبضاعة
    # مكانها **العهدة اللي من غير خط** — دي اللي كانت شايلة كل حاجة قبل ما الصناديق تتقسم،
    # وأرصدة المخزون المسجّلة عليها هي اللي في إيد الراجل فعلاً. الصناديق الجديدة مالية بحتة.
    # من غير الترتيب ده كان `scalar` بيرجّع صف عشوائي، فالمندوب يتقال له «بيع من عهدتك»
    # وهي فاضية والبضاعة في التانية.
    own = db.scalars(
        select(Custody)
        .where(Custody.rep_id == rep_user_id)
        .order_by(Custody.family.is_(None).desc(), Custody.active.desc(), Custody.id)
    ).first()
    if own is not None:
        return (LocationKind.custody, own.id)
    return None


def is_own_store(db: Session, rep_user_id: int, kind: LocationKind, location_id: int) -> bool:
    """المكان ده بتاع المندوب ده؟ — سؤال واحد بإجابة واحدة."""
    store = rep_store(db, rep_user_id)
    return store is not None and store == (kind, location_id)
