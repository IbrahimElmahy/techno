"""أقفال التواريخ — المرحلة ٤ من إعادة الهيكلة على موديل أودو.

الملف ده هو الحكَم الوحيد على السؤال: «هل ينفع يتكتب في الدفتر بالتاريخ ده؟».

أودو بيقفل بتاريخين على مستوى الشركة، وده نفسهم:

* **قفل السنة** (`fiscalyear_lock_date`) — بيقفل على الكل، حتى الأدمن. الميزانية
  اتقدّمت وخلصت، فاللي قبل التاريخ ده مايتلمسش.
* **قفل الفترة** (`period_lock_date`) — بيقفل على اللي مش محاسب. المبيعات والمخازن
  مايرجعوش يكتبوا في شهر اتقفل، والمحاسب (والأدمن) لسه بيقدر يظبط.

الاتنين **فاضيين لحد ما الأدمن يحطهم**. ده شرط اللي طلب رجوع الإقفال: لا حاجة
بتتقفل على حد لوحدها يوم التحديث.

والقفل بيمنع أي حركة على الدفتر في الفترة، مش الترحيل بس: الرجوع لمسودة والإلغاء
وتغيير السطور كلهم بيعدّوا من هنا. لأن إلغاء قيد في شهر مقفول بيغيّر ميزانية الشهر
ده بالظبط زي كتابة قيد جديد فيه.

**التوافق مع `period_lock` القديم:** الجدول ده كان بيتكتب من شاشة الخزينة وما كانش
بيعمل حاجة (`_assert_period_open` كانت فاضية). بقى **سجل تاريخي** — مين قفل وإمتى
وليه — والقيمة الشغّالة بقت في `accounting_setting`. الكتابة بتحط في الاتنين
فالشاشة القديمة والـAPI القديم لسه بيقولوا الصح.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.accounting_setting import AccountingSetting
from src.models.role import Role, RoleName
from src.models.user import User


class LockDateError(Exception):
    """حركة على الدفتر في فترة مقفولة."""


#: الأدوار اللي قفل الفترة مابيقفلش عليها (الـ«adviser» بتاع أودو).
ADVISER_ROLES = frozenset({RoleName.system_admin.value, RoleName.accountant.value})


def get_settings(db: Session) -> AccountingSetting:
    """الصف الواحد — بيتعمل أول مرة يتسأل عنه."""
    row = db.scalar(select(AccountingSetting).order_by(AccountingSetting.id).limit(1))
    if row is None:
        row = AccountingSetting()
        db.add(row)
        db.flush()
    return row


def _peek(db: Session) -> tuple[date | None, date | None]:
    """التاريخين من غير ما نعمل صف — الفحص ده بيتنادى على كل قيد.

    القراءة بس، فلو الجدول لسه فاضي مانكتبش فيه: الكتابة جوّه مسار الترحيل كانت
    هتعمل صف من أول قيد بيتكتب في نظام مالوش أقفال أصلاً.
    """
    row = db.scalar(select(AccountingSetting).order_by(AccountingSetting.id).limit(1))
    if row is None:
        return None, None
    return row.fiscalyear_lock_date, row.period_lock_date


def _is_adviser(db: Session, user_id: int | None) -> bool:
    if user_id is None:
        # حركة من سكربت أو مهمة مجدولة — بتتعامل كمحاسب: قفل السنة لسه بيقفل عليها،
        # وقفل الفترة لأ. النقل والتصليحات بتشتغل كده.
        return True
    name = db.scalar(
        select(Role.name).join(User, User.role_id == Role.id).where(User.id == user_id)
    )
    if name is None:
        return False
    return getattr(name, "value", name) in ADVISER_ROLES


def assert_open(db: Session, when: date | None, *, actor_user_id: int | None = None) -> None:
    """بيرمي `LockDateError` لو التاريخ جوّه فترة مقفولة على الشخص ده.

    `when=None` معناها «النهارده» — القيد اللي بيتكتب من غير تاريخ صريح بياخد يومه.
    والتاريخ المقفول **شامل**: قفل على ٣١/١٢ يعني ٣١/١٢ نفسه مقفول، زي أودو.
    """
    fiscal, period = _peek(db)
    if fiscal is None and period is None:
        return
    day = when or date.today()
    if fiscal is not None and day <= fiscal:
        raise LockDateError(
            f"السنة مقفولة حتى {fiscal:%Y-%m-%d} — مافيش حركة بتاريخ {day:%Y-%m-%d}. "
            "الأدمن هو اللي بيحرّك تاريخ القفل من إعدادات المحاسبة."
        )
    if period is not None and day <= period and not _is_adviser(db, actor_user_id):
        raise LockDateError(
            f"الفترة مقفولة حتى {period:%Y-%m-%d} — مافيش حركة بتاريخ {day:%Y-%m-%d}. "
            "المحاسب أو الأدمن يقدر يعدّل في الفترة دي."
        )


def set_lock_dates(
    db: Session,
    *,
    actor_user_id: int,
    fiscalyear_lock_date: date | None = None,
    period_lock_date: date | None = None,
    note: str | None = None,
) -> AccountingSetting:
    """يحط التاريخين. `None` = يفضي الخانة — الإقفال بيترفع بنفس الشاشة اللي بتحطه."""
    row = get_settings(db)
    row.fiscalyear_lock_date = fiscalyear_lock_date
    row.period_lock_date = period_lock_date
    row.updated_by_user_id = actor_user_id
    db.flush()

    # سجل تاريخي في الجدول القديم — مين قفل وإمتى. القيمة الشغّالة فوق.
    if period_lock_date is not None:
        from src.models.treasury import PeriodLock

        db.add(PeriodLock(locked_through=period_lock_date, note=note,
                          actor_user_id=actor_user_id))
        db.flush()

    from src.services import audit_service

    audit_service.record(
        db, action="accounting.lock_dates", actor_user_id=actor_user_id,
        entity_type="accounting_setting", entity_id=row.id,
        after={"fiscalyear": str(fiscalyear_lock_date or ""),
               "period": str(period_lock_date or ""), "note": note},
    )
    return row
