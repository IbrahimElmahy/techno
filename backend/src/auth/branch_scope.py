"""عزل الفروع — كل واحد بيشوف فرعه.

الفلترة كانت متكتوبة بالإيد في المكان اللي حد افتكرها فيه: ١٧ سطر متفرّقين على ٣٤٦ مسار.
النتيجة إن مدير فرع القاهرة كان بيفتح سجل المبيعات ويلاقي فواتير الإسكندرية وأسيوط. وحاجة
زي دي مابتتحلّش بإضافة سطر تامن عشر — بتتحلّ بمكان واحد بيتقال فيه القاعدة، والشاشة بتناديه.

القاعدة:

* **مدير النظام بيشوف كل حاجة.** ده هو الأكونت اللي فوق الفروع كلها.
* **اللي مالوش فرع بيشوف كل حاجة** — حساب مركزي مش مربوط بمكان.
* **اللي له فرع بيشوف فرعه، وبيشوف كمان المستندات اللي مالهاش فرع.**

الجزء الأخير ده مهم: المستندات المكتوبة قبل العزل `branch_id` بتاعها NULL. إخفاؤها معناه
إن الشركة تفتح النظام بعد التحديث تلاقي سجل المبيعات فاضي — وده أسوأ بكتير من إن مدير فرع
يشوف مستند قديم. اللي بيتكتب من دلوقتي بياخد فرعه، والقديم بيتعبّى بـ`_backfill_branch_docs`.
"""
from __future__ import annotations

from sqlalchemy import or_
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser


def visible_branch_id(current: CurrentUser) -> int | None:
    """الفرع اللي الشخص ده محبوس فيه، أو None لو بيشوف الكل."""
    if current.is_admin:
        return None
    return current.branch_id


def scope(stmt, model, current: CurrentUser):
    """بيضيف شرط الفرع على أي `select` — أو بيرجّعه زي ما هو للّي بيشوف الكل."""
    branch_id = visible_branch_id(current)
    if branch_id is None:
        return stmt
    return stmt.where(or_(model.branch_id == branch_id, model.branch_id.is_(None)))


def may_see(current: CurrentUser, row) -> bool:
    """هل الشخص ده يشوف المستند ده؟ — لفتح مستند واحد بالرقم.

    القوايم بتتفلتر بـ`scope`، بس `GET /sales/{id}` بيجيب صف واحد بالمفتاح، ومن غير الفحص
    ده الرابط المباشر بيبقى باب خلفي حوالين الفلترة كلها.
    """
    branch_id = visible_branch_id(current)
    if branch_id is None:
        return True
    row_branch = getattr(row, "branch_id", None)
    return row_branch is None or row_branch == branch_id


def branch_of_warehouse(db: Session, warehouse_id: int | None) -> int | None:
    """فرع المخزن — المصدر الأول لفرع أي مستند بيحرّك بضاعة.

    البضاعة بتخرج من مكان، والمكان بيتبع فرع. ده أصدق من فرع اللي كاتب الورقة: حساب مركزي
    بيسجّل فاتورة صرف من مخزن فرع، والفاتورة بتاعة الفرع مش بتاعته هو.
    """
    if not warehouse_id:
        return None
    from src.models.warehouse import Warehouse

    wh = db.get(Warehouse, warehouse_id)
    return wh.branch_id if wh else None


def resolve(db: Session, current: CurrentUser, *, warehouse_id: int | None = None) -> int | None:
    """فرع المستند وهو بيتكتب: مخزنه الأول، وبعده فرع اللي كتبه."""
    return branch_of_warehouse(db, warehouse_id) or current.branch_id


def branch_for(db: Session, *, actor_user_id: int | None = None,
               location_kind=None, location_id: int | None = None) -> int | None:
    """فرع المستند وهو بيتكتب — للخدمات اللي مامعاهاش `CurrentUser`.

    الترتيب مقصود: المكان الأول، وبعده اللي كتب. البضاعة بتخرج من مكان والمكان بيتبع فرع،
    فحساب مركزي بيسجّل فاتورة من مخزن فرع بتبقى فاتورة الفرع — مش بتاعته هو.
    """
    kind = getattr(location_kind, "value", location_kind)
    if location_id:
        if kind == "warehouse":
            from src.models.warehouse import Warehouse

            wh = db.get(Warehouse, location_id)
            if wh and wh.branch_id:
                return wh.branch_id
        elif kind == "rep":
            from src.models.user import User

            rep = db.get(User, location_id)
            if rep and rep.branch_id:
                return rep.branch_id
    if actor_user_id:
        from src.models.user import User

        actor = db.get(User, actor_user_id)
        return actor.branch_id if actor else None
    return None


def visible(current: CurrentUser, rows):
    """يفلتر قايمة جاهزة — للمسارات اللي بتاخد صفوفها من خدمة مش من `select`.

    نفس قاعدة `scope` بالظبط، بس بعد ما الصفوف تتجاب. أبطأ شوية، بس أهون بكتير من إن
    مسار يفضل بره العزل لأن استعلامه مش مكتوب في مكان يتعدّل فيه.
    """
    if visible_branch_id(current) is None:
        return list(rows)
    return [r for r in rows if may_see(current, r)]
