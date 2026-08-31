"""ينقل صناديق a5 (الحسابات تحت «الخزينة») ويربط كل صندوق بمندوبه وخطه.

    python -m src.scripts.import_a5_treasuries --file C:/pgtmp/chart_AL.tsv
    python -m src.scripts.import_a5_treasuries --file C:/pgtmp/chart_AL.tsv --yes

المصدر تصدير شجرة a5: UTF-16LE بفاصل `~`، والسطر اللي بيبدأ بـ`B` هو حساب فرعي.
اللي `AccMain_id = 1` هما الصناديق — ١٣ صندوق.

---------------------------------------------------------------------------
تلات قرارات، كل واحد فيهم كان ممكن يتاخد بالعكس:

* **الصندوق بيتبنّى، مابيتعملش من جديد.** الـ١٣ حساب دول موجودين خلاص في شجرتنا من نقل
  الشجرة (`AL-A5S-<AccBrnch_id>`) وشايلين حركتهم من a5 — ٦٨٢١ سطر على المركز الرئيسي
  لوحده. حساب جديد بنفس الاسم معناه رصيدين لصندوق واحد: القديم فيه التاريخ والجديد فيه
  النهارده، ومحدش هيعرف أنهي واحد الصح.

* **«تكنو» بتتحوّل «بولي».** المستخدم قالها بالنص: «تكنو هو بولي». الاسم المنقول يتوحّد
  هنا، مايتسابش خطين بتسميتين — لأن الفاتورة بتدوّر على صندوقها بقيمة الخط، و«تكنو»
  مش هتلاقي «بولي».

* **الربط بالمندوب بالاسم، واللي مايتطابقش يتقال.** صندوق مربوط بالراجل الغلط أسوأ من
  صندوق مش مربوط: التاني بيشتكي أول فاتورة، والأول بيسكت والفلوس بتروح مكان تاني.

**كود a5 (`Brnch_Cod`) مش مفتاح.** `00100010` مكتوب على صندوقين — «تكنو سيارة الشرقية»
و«أبيض السيارة (د)». فالكود بيتعرض في التقرير بس، والهوية `AccBrnch_id`.

⚠️ **مافيش أرصدة افتتاحية.** الرصيد بيتحسب من الحركة. رصيد أول مدة قرار منفصل بمستند.
"""
from __future__ import annotations

import re
import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.employee import Employee
from src.models.ledger import Account, AccountNature, AccountType, Direction
from src.models.role import Role, RoleName
from src.models.user import User
from src.models.warehouse import Custody, HolderType
from src.services.customer_merge_service import FAMILY_POLY, FAMILY_WHITE

# الحساب الرئيسي «الخزينة» في a5 — الصناديق كلها تحته.
TREASURY_MAIN_ID = "1"

# «تكنو» عندهم = «بولي» عندنا. البادئة على اسم الصندوق هي الخط، زي ما هي على اسم العميل.
FAMILY_WORDS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"تكنو"), FAMILY_POLY),
    (re.compile(r"بول[يى]"), FAMILY_POLY),
    (re.compile(r"[اأ]بيض"), FAMILY_WHITE),
]

# اسم الخزنة العامة في a5. دي اللي بتبقى `treasury_account` للفرع.
MAIN_SAFE = "خزينة المركز الرئيسى"

_DIACRITICS = re.compile(r"[\u064b-\u0652\u0670\u0640]")
_NOT_ARABIC = re.compile(r"[^\u0621-\u064a]")
# كلمات مالهاش لازمة في المطابقة: «صندوق أبيض السيارة (أ)» و«مندوب السياره ( أ )» نفس
# الراجل، والفرق كله في الكلام اللي حواليه.
_NOISE = ("صندوق", "خزينه", "مندوب", "ابيض", "بولي", "تكنو")


def _norm(text: str) -> str:
    """يشيل التشكيل والمسافات والأقواس، ويوحّد أ/إ/آ و ة/ه و ى/ي.

    من غير ده «السياره ( أ )» و«السياره (أ)» اسمين مختلفين، وهما نفس العربية.
    """
    s = _DIACRITICS.sub("", text or "")
    for a, b in (("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ة", "ه"),
                 ("ى", "ي"), ("ؤ", "و"), ("ئ", "ي")):
        s = s.replace(a, b)
    return _NOT_ARABIC.sub("", s)


def match_key(name: str) -> str:
    """المفتاح اللي بيربط الصندوق بمندوبه: العربية المجرّدة من غير كلام الزينة."""
    k = _norm(name)
    changed = True
    while changed:
        changed = False
        for word in _NOISE:
            if k.startswith(word):
                k = k[len(word):]
                changed = True
    if k.startswith("ال"):
        k = k[2:]
    return k


def family_of(name: str) -> str | None:
    """خط الصندوق من اسمه، أو None لصندوق مالوش خط (بونص، بيع عدد وأدوات، الخزنة العامة)."""
    for rx, family in FAMILY_WORDS:
        if rx.search(name):
            return family
    return None


def canonical_name(name: str) -> str:
    """اسم الصندوق بعد توحيد التسمية — «تكنو» بتبقى «بولي»، وبس."""
    return re.sub(r"تكنو", FAMILY_POLY, name).strip()


def read_boxes(path: str) -> list[tuple[int, str, str]]:
    """(AccBrnch_id, الاسم زي ما هو في a5, Brnch_Cod) لكل صندوق تحت «الخزينة»."""
    with open(path, encoding="utf-16-le", newline="") as fh:
        raw = fh.read()
    out: list[tuple[int, str, str]] = []
    for line in raw.splitlines():
        parts = line.lstrip("\ufeff").split("~")
        # B ~ AccBrnch_id ~ AccMain_id ~ AccBrnch_N ~ AccMain_N ~ Brnch_Cod ~ TypeN ~ Brn
        if len(parts) < 6 or parts[0] != "B" or parts[2] != TREASURY_MAIN_ID:
            continue
        out.append((int(parts[1]), parts[3].strip(), parts[5].strip()))
    return out


def _rep_index(db, branch_id: int | None) -> tuple[dict[str, User], set[str]]:
    """مناديب المبيعات النشطين مفهرسين بمفتاح المطابقة، ومعاهم المفاتيح المكرّرة.

    المكرّر مابيتربطش: مندوبين اسمهم بيطابق نفس الصندوق = تخمين، والتخمين هنا بيوقّع
    فلوس في جيب حد تاني.
    """
    rep_role = db.scalars(select(Role).where(Role.name == RoleName.sales_rep)).first()
    if rep_role is None:
        return {}, set()
    reps = db.scalars(select(User).where(User.role_id == rep_role.id,
                                         User.active.is_(True))).all()
    if branch_id is not None:
        # الفرع بيضيّق البحث. مندوب في فرع تاني ماينفعش يتربط بصندوق شجرة الفرع ده حتى لو
        # الاسم بيطابق — الاسم بيتكرر بين الفروع، والحساب لأ.
        emp_branch = {
            e.user_id: e.branch_id
            for e in db.scalars(select(Employee).where(Employee.user_id.is_not(None))).all()
        }
        scoped = [u for u in reps if emp_branch.get(u.id) == branch_id]
        if scoped:
            reps = scoped
    index: dict[str, User] = {}
    dupes: set[str] = set()
    for u in reps:
        k = match_key(u.full_name or u.username or "")
        if not k:
            continue
        if k in index:
            dupes.add(k)
        index[k] = u
    for k in dupes:
        index.pop(k, None)
    return index, dupes


def run(*, path: str, prefix: str, execute: bool) -> None:
    db = SessionLocal()
    try:
        boxes = read_boxes(path)
        if not boxes:
            raise SystemExit(f"مالقيتش ولا صندوق في {path} — الملف اتغيّر شكله؟")

        # الفرع بيتاخد من الحساب الرئيسي «الخزينة» بتاع نفس الشجرة، مش بيتخمّن: الشجرة
        # اتنقلت مرة بالبادئة دي، وأبوها عارف هو تبع أنهي فرع.
        parent = db.scalar(select(Account).where(Account.code == f"{prefix}A5M-1"))
        branch_id = parent.branch_id if parent is not None else None

        rep_index, dupes = _rep_index(db, branch_id)

        header = f"{'الصندوق (بعد التوحيد)':<30}{'الخط':<8}{'كود a5':<12}{'المندوب':<24}الحساب"
        print(f"الملف           {path}")
        print(f"البادئة         {prefix}")
        print(f"الفرع           {branch_id}")
        print(f"صناديق في a5    {len(boxes)}")
        print(f"مناديب للمطابقة {len(rep_index)}")
        if dupes:
            print(f"⚠️ مفاتيح مكرّرة اتشالت من المطابقة: {'، '.join(sorted(dupes))}")
        print()
        print(header)
        print("-" * len(header))

        plan: list[tuple[Account, str, str | None, User | None, tuple[int, str, str]]] = []
        missing_accounts: list[tuple[int, str]] = []
        unlinked: list[str] = []

        for a5_id, raw_name, a5_code in boxes:
            name = canonical_name(raw_name)
            family = family_of(raw_name)
            code = f"{prefix}A5S-{a5_id}"
            acc = db.scalar(select(Account).where(Account.code == code))
            if acc is None:
                missing_accounts.append((a5_id, name))
            rep = rep_index.get(match_key(raw_name))
            if family and rep is None:
                unlinked.append(name)
            plan.append((acc, name, family, rep, (a5_id, raw_name, a5_code)))
            print(f"{name:<30}{family or '—':<8}{a5_code:<12}"
                  f"{(rep.full_name if rep else '—'):<24}"
                  f"{(code if acc is not None else 'مش موجود — هيتعمل')}")

        renamed = [p for p in plan if p[1] != p[4][1]]
        print(f"\n{'أسماء هتتحوّل من «تكنو» لـ«بولي»':<40}{len(renamed):>4}")
        print(f"{'صناديق ليها مندوب وخط':<40}"
              f"{len([p for p in plan if p[2] and p[3]]):>4}")
        print(f"{'صناديق من غير خط (خزائن مستقلة)':<40}"
              f"{len([p for p in plan if not p[2]]):>4}")
        if missing_accounts:
            print("\nحسابات مش في الشجرة — هتتعمل:")
            for a5_id, name in missing_accounts:
                print(f"   {prefix}A5S-{a5_id:<10}{name}")
        if unlinked:
            # بالاسم، مش بالعدد. «٣ صناديق مااتربطتش» مش معلومة يتصرف بيها حد.
            print("\n🔶 صناديق ليها خط ومااتربطتش بمندوب — الاسم مايطابقش حد:")
            for name in unlinked:
                print(f"   {name}")

        # العهد اللي هتتعمل — (مندوب، خط) اللي لسه مالوش صف.
        existing = db.scalars(select(Custody).where(Custody.rep_id.is_not(None))).all()
        have = {(c.rep_id, c.family) for c in existing}
        to_create = [(p[3].id, p[2]) for p in plan
                     if p[2] and p[3] and (p[3].id, p[2]) not in have]
        print(f"\n{'عهد (مندوب × خط) هتتعمل':<40}{len(to_create):>4}")
        print(f"{'عهد موجودة خلاص':<40}"
              f"{len([p for p in plan if p[2] and p[3] and (p[3].id, p[2]) in have]):>4}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        made_accounts = made_custodies = renamed_n = retyped = 0
        for acc, name, family, rep, (a5_id, _raw, _a5_code) in plan:
            if acc is None:
                acc = Account(
                    account_type=AccountType.treasury, owner_ref=None,
                    normal_side=Direction.debit, branch_id=branch_id,
                    code=f"{prefix}A5S-{a5_id}", parent_id=parent.id if parent else None,
                )
                db.add(acc)
                db.flush()
                made_accounts += 1
            if acc.name != name:
                acc.name = name
                renamed_n += 1
            if acc.account_type != AccountType.treasury:
                acc.account_type = AccountType.treasury
                retyped += 1
            acc.nature = AccountNature.asset
            acc.is_postable = True
            # الخزنة العامة للفرع. `is_system` هي اللي بتفرّقها عن صندوق البونص لما
            # `get_or_create_singleton` تدوّر على خزنة الفرع — الاتنين نوعهم `treasury`
            # و`owner_ref` بتاعهم NULL.
            if name == MAIN_SAFE:
                acc.is_system = True
            db.flush()

            if not (family and rep):
                continue
            custody = db.scalar(select(Custody).where(
                Custody.rep_id == rep.id, Custody.family == family))
            if custody is None:
                custody = Custody(holder_type=HolderType.rep, rep_id=rep.id,
                                  family=family, warehouse_id=None, account_id=acc.id)
                db.add(custody)
                db.flush()
                made_custodies += 1
            else:
                custody.account_id = acc.id
            # `owner_ref` بتشاور على العهدة — ودي كمان بتخرّج الصندوق من بحث الخزنة العامة.
            acc.owner_ref = custody.id
            db.flush()

        db.commit()
        print(f"\n✔ حسابات اتعملت      {made_accounts}")
        print(f"✔ أسماء اتوحّدت      {renamed_n}")
        print(f"✔ حسابات بقت خزينة   {retyped}")
        print(f"✔ عهد (مندوب × خط)   {made_custodies}")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    file_path = args[args.index("--file") + 1] if "--file" in args else "C:/pgtmp/chart_AL.tsv"
    code_prefix = args[args.index("--prefix") + 1] if "--prefix" in args else "AL-"
    run(path=file_path, prefix=code_prefix, execute="--yes" in args)
