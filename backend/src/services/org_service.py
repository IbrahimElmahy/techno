"""Branch helpers — 024-multi-branch.

The company is a tree: one company, its branches, and under each branch a full independent
copy of the data (accounts, warehouses, reps, customers, treasuries). This module resolves the
*default branch* — the one every legacy/branch-less record is homed to — so the whole system
keeps working as a single branch until more branches are added.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.org import Branch, Governorate


def default_branch(db: Session) -> Branch:
    """The company's main branch — a head-office branch, else the oldest, else created.

    Every account/customer/document with no branch belongs here. Idempotent.
    """
    branch = db.scalar(
        select(Branch)
        .where(Branch.is_head_office.is_(True), Branch.active.is_(True))
        .order_by(Branch.id)
    )
    if branch is not None:
        return branch
    branch = db.scalar(select(Branch).order_by(Branch.id))
    if branch is not None:
        return branch
    # Fresh install: create the main branch (a branch needs a governorate).
    gov = db.scalar(select(Governorate).order_by(Governorate.id))
    if gov is None:
        gov = Governorate(name="غير محدد")
        db.add(gov)
        db.flush()
    branch = Branch(name="الفرع الرئيسي", governorate_id=gov.id, is_head_office=True)
    db.add(branch)
    db.flush()
    return branch


def resolve_branch_id(db: Session, branch_id: int | None) -> int:
    """A concrete branch id — the given one, or the default branch when none is supplied."""
    if branch_id is not None:
        return branch_id
    return default_branch(db).id


def factory_branches(db: Session) -> list[Branch]:
    """فروع التصنيع الشغّالة (`is_factory`) — النهارده السادات وحده."""
    return db.scalars(select(Branch).where(
        Branch.is_factory.is_(True), Branch.active.is_(True)).order_by(Branch.id)).all()


def production_branch_problem(db: Session, branch_id: int | None,
                              warehouse_ids) -> tuple[int | None, str | None]:
    """**التصنيع في فرع المصنع بس.** بيرجّع (الفرع اللي الورقة تتكتب عليه، سبب الرفض).

    أوامر التشغيل كانت بتتفتح على أي فرع ومن أي مخزن — والفرع في الورقة كان خانة
    اختيارية جنبها قايمة الفروع كلها. والإنتاج بيحصل في المصنع وبس: ورقة على العلياء
    معناها خامات اتصرفت من مخزن مابيصنّعش وتام دخل مكان مافيهوش خط إنتاج.

    * مافيش فرع مصنع متعلّم ⇒ مافيش قيد (السلوك القديم زي ما هو) — القيد قرار
      بيتاخد من كارت الفرع، مش ثابت في الكود.
    * فرع واحد بس مصنع والورقة من غير فرع ⇒ بتاخده.
    * الفرع لازم يكون مصنع، **وكل مخزن على الورقة** لازم يكون من نفس الفرع — مخزن
      من فرع تاني هو نفس الغلطة من باب تاني.
    """
    factories = factory_branches(db)
    if not factories:
        return branch_id, None
    ids = {b.id for b in factories}
    names = "، ".join(b.name for b in factories)
    if branch_id is None and len(factories) == 1:
        branch_id = factories[0].id
    if branch_id not in ids:
        return branch_id, f"أوامر التشغيل في فرع المصنع بس ({names})."
    from src.models.warehouse import Warehouse

    wanted = {int(w) for w in warehouse_ids if w is not None}
    if wanted:
        foreign = db.scalars(select(Warehouse).where(
            Warehouse.id.in_(wanted),
            (Warehouse.branch_id != branch_id) | Warehouse.branch_id.is_(None))).all()
        if foreign:
            listed = "، ".join(w.name for w in foreign[:3])
            return branch_id, f"المخزن «{listed}» مش من فرع المصنع ({names})."
    return branch_id, None


def list_branches(db: Session, *, active_only: bool = False) -> list[Branch]:
    stmt = select(Branch)
    if active_only:
        stmt = stmt.where(Branch.active.is_(True))
    return db.scalars(stmt.order_by(Branch.is_head_office.desc(), Branch.id)).all()


# --------------------------------------------------------------------------- فصل الفروع
#
# **مستند الفرع بيستخدم حاجات فرعه وبس** (طلب العميل ٢٠٢٦-١٠-٠٤: «ماتدخلهمش في بعض»).
#
# الشاشات كانت بتفلتر القوايم ساعات، والسيرفر ماكانش بيسأل: فاتورة على العلياء ممكن
# يبقى سطر فيها من مخزن أكتوبر، والكاش في صندوق السادات، والعميل كارت أكتوبر. القيد
# بيتوازن والمخزون بيتحرك، ومحدش بيعرف إن الفرعين اتخلطوا غير في جرد آخر الشهر.
#
# القاعدة هنا في مكان واحد، وكل خدمة بتناديها في الإنشاء والتعديل:
#
# * **فرع المستند** = فرع اللي بيكتب لو هو محبوس في فرع، وإلا (أدمن/مالك/حساب مركزي)
#   فرع أول مكان على المستند — يعني الفرع اللي اختاره بمخزنه.
# * كل مخزن/عهدة على السطور، وكل خزنة/صندوق بيتحرك فيه فلوس، والعميل/المورد والمندوب
#   لازم يكونوا من نفس الفرع. **اللي مالوش فرع مشترك** وبيعدّي (عميل `branch_id` فاضي).
# * **التعديل مابيتقفلش على القديم:** أي حاجة كانت على المستند قبل التعديل (`keep`)
#   بتعدّي حتى لو مخالفة — تاريخ a5 فيه خلط، وتصليح سعر في فاتورة قديمة مايصحش
#   يترفض عشان مخزن محدش لمسه. اللي بيتغيّر أو بيتزوّد هو اللي بيتفحص.
# * الاستثناء الوحيد: التحويل بين الفروع (مخزون أو نقدية) — شوف `assert_transfer_ends`.


class BranchMixError(Exception):
    """مستند بيخلط فرعين — بيرجع 409 برسالة بتسمّي الحاجة اللي من فرع تاني."""


def _kind(kind) -> str:
    return str(getattr(kind, "value", kind))


def bound_branch(db: Session, user_id: int | None) -> int | None:
    """الفرع اللي المستخدم ده محبوس فيه — أو None للأدمن/المالك/الحساب المركزي.

    نفس قاعدة `branch_scope.visible_branch_id` بالظبط، بس من رقم المستخدم (الخدمات
    مامعاهاش `CurrentUser`).
    """
    if not user_id:
        return None
    from src.models.role import Role, RoleName
    from src.models.user import User

    user = db.get(User, user_id)
    if user is None or user.branch_id is None:
        return None
    role = db.get(Role, user.role_id)
    if role is not None and role.name in (RoleName.system_admin, RoleName.owner):
        return None
    return user.branch_id


def location_branch(db: Session, kind, location_id: int | None) -> int | None:
    """فرع مكان البضاعة: المخزن بفرعه، والعهدة بفرع مندوبها (أو مخزنها)."""
    if not location_id:
        return None
    from src.models.user import User
    from src.models.warehouse import Custody, Warehouse

    if _kind(kind) == "warehouse":
        wh = db.get(Warehouse, location_id)
        return wh.branch_id if wh else None
    custody = db.get(Custody, location_id)
    if custody is None:
        return None
    if custody.rep_id:
        rep = db.get(User, custody.rep_id)
        return rep.branch_id if rep else None
    if custody.warehouse_id:
        wh = db.get(Warehouse, custody.warehouse_id)
        return wh.branch_id if wh else None
    return None


def cash_account_branch(db: Session, account_id: int | None) -> int | None:
    """فرع حساب الكاش (خزنة/صندوق/عهدة).

    ⚠️ **العهدة الأول، مش `account.branch_id`:** حسابات عهد مناديب العلياء والسادات
    اتعملت على الفرع الافتراضي (أكتوبر) — فرع الحساب نفسه غلط، وفرع المندوب هو الصح.
    """
    if not account_id:
        return None
    from src.models.ledger import Account
    from src.models.treasury import Treasury
    from src.models.user import User
    from src.models.warehouse import Custody, Warehouse

    custody = db.scalar(select(Custody).where(Custody.account_id == account_id)
                        .order_by(Custody.active.desc(), Custody.id))
    if custody is not None:
        if custody.rep_id:
            rep = db.get(User, custody.rep_id)
            if rep is not None and rep.branch_id:
                return rep.branch_id
        if custody.warehouse_id:
            wh = db.get(Warehouse, custody.warehouse_id)
            if wh is not None and wh.branch_id:
                return wh.branch_id
    safe = db.scalar(select(Treasury).where(Treasury.account_id == account_id))
    if safe is not None and safe.branch_id:
        return safe.branch_id
    acc = db.get(Account, account_id)
    return acc.branch_id if acc else None


def routed_treasury_accounts(db: Session, branch_id: int | None) -> set[int]:
    """الخزنة اللي «التوجيه المحاسبي» مشاور عليها للفرع ده — **مسموحة للفرع حتى لو حسابها
    على فرع تاني**.

    «خزينة المركز الرئيسى» (حساب العلياء) متوجّهة للفروع التلاتة عن قصد
    (`scripts/unify_general_treasury.py`: الخزنة الفعلية واحدة في المكتب، زي a5). ده قرار
    إعداد مش خلط — ولو الشركة فصلت خزنة لكل فرع من شاشة التوجيه، الفحص بيضيق لوحده.
    """
    if not branch_id:
        return set()
    from src.models.account_routing import AccountRouting

    return set(db.scalars(select(AccountRouting.account_id).where(
        AccountRouting.role == "treasury", AccountRouting.branch_id == branch_id)).all())


def treasury_branch(db: Session, treasury_id: int | None) -> int | None:
    if not treasury_id:
        return None
    from src.models.treasury import Treasury

    safe = db.get(Treasury, treasury_id)
    if safe is None:
        return None
    return safe.branch_id or cash_account_branch(db, safe.account_id)


def document_branch(db: Session, *, actor_user_id: int | None, locations=(), owners=(),
                    cash_accounts=(), treasuries=(), existing: int | None = None) -> int | None:
    """فرع المستند وهو بيتكتب.

    التعديل بيحتفظ بفرعه (`existing`). اللي محبوس في فرع ⇒ فرعه. غير كده ⇒ فرع أول
    مكان على المستند، وبعده `owners` (فروع جاهزة: عميل السند، مورده، مندوبه، حساب
    مصروفه)، وبعده أول خزنة — ده الفرع اللي الأدمن اختاره فعلاً.

    الخزنة آخر واحدة عن قصد: «خزينة المركز الرئيسى» مشتركة بين الفروع (توجيه)، وحسابها
    على العلياء — لو اتقرت الأول، كل سند مكتبي من الأدمن هيطلع على العلياء.
    """
    if existing:
        return existing
    bound = bound_branch(db, actor_user_id)
    if bound:
        return bound
    for kind, loc in locations:
        b = location_branch(db, kind, loc)
        if b:
            return b
    for b in owners:
        if b:
            return b
    for acc in cash_accounts:
        b = cash_account_branch(db, acc)
        if b:
            return b
    for t in treasuries:
        b = treasury_branch(db, t)
        if b:
            return b
    return None


def resource_keys(*, locations=(), cash_accounts=(), treasuries=(), accounts=(),
                  customer_id=None, supplier_id=None, rep_id=None) -> frozenset:
    """بصمة حاجات المستند — اللي كان عليه قبل التعديل بيتبعت `keep` للفحص."""
    keys = {("loc", _kind(k), int(i)) for k, i in locations if k and i}
    keys |= {("cash", int(a)) for a in cash_accounts if a}
    keys |= {("treasury", int(t)) for t in treasuries if t}
    keys |= {("account", int(a)) for a in accounts if a}
    if customer_id:
        keys.add(("customer", int(customer_id)))
    if supplier_id:
        keys.add(("supplier", int(supplier_id)))
    if rep_id:
        keys.add(("rep", int(rep_id)))
    return frozenset(keys)


def _branch_name(db: Session, branch_id: int | None) -> str:
    b = db.get(Branch, branch_id) if branch_id else None
    return b.name if b else f"#{branch_id}"


def _location_label(db: Session, kind, location_id: int) -> str:
    from src.models.user import User
    from src.models.warehouse import Custody, Warehouse

    if _kind(kind) == "warehouse":
        wh = db.get(Warehouse, location_id)
        return f"المخزن «{wh.name}»" if wh else f"المخزن #{location_id}"
    custody = db.get(Custody, location_id)
    rep = db.get(User, custody.rep_id) if custody and custody.rep_id else None
    if rep is not None:
        return f"عهدة «{rep.full_name or rep.username}»"
    return f"العهدة #{location_id}"


def branch_mix_problem(db: Session, branch_id: int | None, *, locations=(), cash_accounts=(),
                       treasuries=(), accounts=(), customer_id: int | None = None,
                       supplier_id: int | None = None, rep_id: int | None = None,
                       keep: frozenset = frozenset()) -> str | None:
    """أول حاجة على المستند من فرع غير فرعه — رسالة بالعربي بتسمّيها، أو None.

    `cash_accounts` الخزن اللي الفلوس بتتحرك فيها فعلاً (مش اللي متسجّلة بصفر)، و`accounts`
    حسابات الترحيل اللي اتختارت بالإيد (إيراد/مصروف/سطر قيد) — كل فرع ليه شجرته.
    """
    if not branch_id:
        return None
    from src.models.customer import Customer
    from src.models.ledger import Account
    from src.models.supplier import Supplier
    from src.models.treasury import Treasury
    from src.models.user import User

    here = _branch_name(db, branch_id)

    def say(label: str, other: int) -> str:
        return (f"{label} تبع فرع «{_branch_name(db, other)}» — والمستند على فرع «{here}». "
                "ماينفعش تخلط فروع في مستند واحد.")

    for kind, loc in locations:
        if not kind or not loc or ("loc", _kind(kind), int(loc)) in keep:
            continue
        b = location_branch(db, kind, loc)
        if b and b != branch_id:
            return say(_location_label(db, kind, loc), b)
    routed = (routed_treasury_accounts(db, branch_id)
              if (cash_accounts or treasuries or accounts) else set())
    for acc_id in cash_accounts:
        if not acc_id or ("cash", int(acc_id)) in keep or int(acc_id) in routed:
            continue
        b = cash_account_branch(db, acc_id)
        if b and b != branch_id:
            acc = db.get(Account, acc_id)
            return say(f"الخزنة «{(acc.name or acc.code) if acc else acc_id}»", b)
    for t_id in treasuries:
        if not t_id or ("treasury", int(t_id)) in keep:
            continue
        safe = db.get(Treasury, t_id)
        if safe is not None and safe.account_id in routed:
            continue
        b = treasury_branch(db, t_id)
        if b and b != branch_id:
            return say(f"الخزنة «{safe.name if safe else t_id}»", b)
    for acc_id in accounts:
        if not acc_id or ("account", int(acc_id)) in keep:
            continue
        if int(acc_id) in routed:
            continue
        b = cash_account_branch(db, acc_id)
        if b and b != branch_id:
            acc = db.get(Account, acc_id)
            return say(f"الحساب «{(acc.name or acc.code) if acc else acc_id}»", b)
    if customer_id and ("customer", int(customer_id)) not in keep:
        cust = db.get(Customer, customer_id)
        if cust is not None and cust.branch_id and cust.branch_id != branch_id:
            return say(f"العميل «{cust.name}»", cust.branch_id)
    if supplier_id and ("supplier", int(supplier_id)) not in keep:
        sup = db.get(Supplier, supplier_id)
        if sup is not None and sup.branch_id and sup.branch_id != branch_id:
            return say(f"المورد «{sup.name}»", sup.branch_id)
    if rep_id and ("rep", int(rep_id)) not in keep:
        rep = db.get(User, rep_id)
        if rep is not None and rep.branch_id and rep.branch_id != branch_id:
            return say(f"المندوب «{rep.full_name or rep.username}»", rep.branch_id)
    return None


def assert_same_branch(db: Session, branch_id: int | None, *, error=BranchMixError,
                       **resources) -> None:
    """`branch_mix_problem` بيرفع — بنوع خطأ الخدمة لو اتبعت (`error=SalesError`)."""
    problem = branch_mix_problem(db, branch_id, **resources)
    if problem:
        raise error(problem)


def assert_actor_branch(db: Session, actor_user_id: int | None, branch_id: int | None, *,
                        what: str, error=BranchMixError) -> None:
    """اللي محبوس في فرع مايكتبش على فرع تاني — للمستندات اللي فرعها من مكانها (إذن/هالك/جرد)."""
    bound = bound_branch(db, actor_user_id)
    if bound and branch_id and branch_id != bound:
        raise error(f"{what} تبع فرع «{_branch_name(db, branch_id)}» — "
                    f"وانت على فرع «{_branch_name(db, bound)}».")


def assert_transfer_ends(db: Session, actor_user_id: int | None, from_branch: int | None,
                         to_branch: int | None, *, what: str = "التحويل",
                         error=BranchMixError) -> None:
    """**التحويل بين الفروع مسموح** — ده المستند الوحيد اللي مكانه بين فرعين
    («تحويلات مخازن فروع» / «تحويلات نقدية فروع»). بس اللي محبوس في فرع لازم يكون
    طرف فيه: بيبعت **من** فرعه أو بيطلب **لـ**فرعه. تحويل بين فرعين غيره مش شغله.
    """
    bound = bound_branch(db, actor_user_id)
    if not bound:
        return
    ends = {b for b in (from_branch, to_branch) if b}
    if ends and bound not in ends:
        raise error(f"{what} بين «{_branch_name(db, from_branch)}» و«{_branch_name(db, to_branch)}» "
                    f"— وانت على فرع «{_branch_name(db, bound)}». لازم فرعك يكون طرف فيه.")
