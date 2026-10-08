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

from contextvars import ContextVar

from sqlalchemy import or_
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser

#: **فلتر الفرع بتاع المالك/الأدمن** (٢٠٢٦-١٠-٠٤). اللي فوق الفروع بيشوف التلاتة، ومن الشريط
#: فوق بيختار فرع يتفرّج عليه — الواجهة بتبعته في هيدر `X-View-Branch` مع كل طلب، والـmiddleware
#: في `main.py` بيحطه هنا. فكل قايمة وتقرير بيسألوا `visible_branch_id` بيتفلتروا من مكان واحد،
#: من غير ما نلمس ٩٠ موضع.
_view_branch: ContextVar[int | None] = ContextVar("view_branch", default=None)


def set_view_branch(branch_id: int | None):
    """بيتنده من الـmiddleware بس — بيرجّع التوكن عشان يترجع بعد الطلب."""
    return _view_branch.set(branch_id)


def reset_view_branch(token) -> None:
    _view_branch.reset(token)


def visible_branch_id(current: CurrentUser) -> int | None:
    """الفرع اللي الشخص ده بيشوفه، أو None لو بيشوف الكل.

    موظف الفرع: فرعه، دايماً. المالك/الأدمن: الفرع اللي اختاره من الفلتر، وإلا الكل.
    """
    if current.is_admin:
        return _view_branch.get()
    return current.branch_id


def sees_all_branches(current: CurrentUser) -> bool:
    """**صلاحية** مش عرض: اللي فوق الفروع (أو مالوش فرع) — مابيتأثرش بفلتر الفرع.

    الأماكن اللي كانت بتسأل «`visible_branch_id` فاضي؟» عشان تدّي صلاحية (اعتماد تحويل
    أي فرع مثلاً) بتسأل هنا، عشان المالك وهو مفلتر على فرع مايفقدش صلاحيته.
    """
    return current.is_admin or current.branch_id is None


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


# ------------------------------------------------------- الموارد البشرية بفرع الموظف
#
# الحضور والأجازات ونهاية الخدمة والورديات مالهاش `branch_id` في جدولها — فرعها هو فرع
# الموظف. نسخ عمود الفرع على كل يوم حضور كان هيخلّي نقل موظف من فرع لفرع يسيب تاريخه ورا
# في الفرع القديم، فالعزل بيمشي من الموظف نفسه: سؤال واحد هنا بدل ما كل شاشة تكتب الـjoin.


def employee_ids(current: CurrentUser):
    """أرقام الموظفين اللي الشخص ده بيشوفهم — `select` جاهز لـ`in_`، أو None لو بيشوف الكل.

    نفس قاعدة `scope`: فرعه + الموظف اللي مالوش فرع، وفلتر المالك من الشريط محترم.
    """
    branch_id = visible_branch_id(current)
    if branch_id is None:
        return None
    from sqlalchemy import select

    from src.models.employee import Employee

    return select(Employee.id).where(
        or_(Employee.branch_id == branch_id, Employee.branch_id.is_(None)))


def scope_by_employee(stmt, employee_id_column, current: CurrentUser):
    """`scope` للجداول اللي فرعها هو فرع الموظف — `employee_id_column` هو عمود الموظف فيها."""
    ids = employee_ids(current)
    if ids is None:
        return stmt
    return stmt.where(employee_id_column.in_(ids))


def may_touch_employee(db: Session, current: CurrentUser, employee_id: int | None) -> bool:
    """هل يكتب على الموظف ده (حضور، أجازة، وردية، نهاية خدمة)؟ — **صلاحية** مش عرض.

    موظف الفرع: موظفين فرعه (واللي مالهمش فرع). اللي فوق الفروع: الكل، حتى لو مفلتر على
    فرع تاني من الشريط — الفلتر بيضيّق القوايم، مش بيسحب صلاحية. موظف مش موجود بيرجع True
    عشان الخدمة نفسها هي اللي تقول «غير موجود» برسالتها.
    """
    if sees_all_branches(current) or employee_id is None:
        return True
    from src.models.employee import Employee

    emp = db.get(Employee, employee_id)
    return emp is None or emp.branch_id is None or emp.branch_id == current.branch_id
