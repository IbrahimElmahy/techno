from __future__ import annotations

import re
import sys
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.ledger import Account, AccountNature, Direction

_SHARED_TYPE: dict[int, int] = {
    1: 1, 2: 2, 3: 1, 4: 2, 5: 1, 6: 2, 7: 3, 8: 4, 9: 3, 10: 4,
    11: 3, 12: 4, 13: 3, 14: 1, 15: 3, 16: 1, 17: 2, 18: 1, 19: 2,
    20: 2, 21: 4, 22: 1, 23: 1, 24: 2, 25: 1, 26: 2, 27: 2, 28: 1,
    29: 1, 30: 1, 31: 1, 32: 1, 33: 3, 34: 2, 35: 2, 36: 1, 37: 3,
    38: 3, 39: 2, 40: 2, 41: 2, 42: 4, 43: 3, 44: 2, 45: 3, 46: 1,
    47: 1, 48: 3, 49: 1, 50: 1, 51: 2, 52: 2, 53: 1,
}
_BRANCH_TYPE: dict[tuple[str, int], int] = {
    ("AL-", 54): 1, ("AL-", 55): 3, ("AL-", 56): 3,
    ("", 54): 3, ("", 55): 3, ("", 56): 3, ("", 57): 3, ("", 58): 3,
    ("", 63): 4,
}
_EQUITY_IDS = {2, 19, 27, 35, 41}
_EQUITY_NAME = re.compile("رأس المال|جار[ىي] الشركاء|أرباح وخسائر|مخصصات")
_DRAWINGS = re.compile("مسحوب")

_CODE_RE = re.compile(r"^(AL-)?A5([MS])-(\d+)$")


def _branch_of(code: str) -> str:
    return "AL-" if code.startswith("AL-") else ""


def target_for_group(a5id: int, prefix: str, name: str) -> tuple[AccountNature, Direction] | None:
    t = _BRANCH_TYPE.get((prefix, a5id), _SHARED_TYPE.get(a5id))
    if t is None:
        return None
    if t == 1:
        if _DRAWINGS.search(name or "") or (prefix == "AL-" and a5id == 54):
            return AccountNature.equity, Direction.credit
        return AccountNature.asset, Direction.debit
    if t == 2:
        if a5id in _EQUITY_IDS or _EQUITY_NAME.search(name or ""):
            return AccountNature.equity, Direction.credit
        return AccountNature.liability, Direction.credit
    if t == 3:
        return AccountNature.expense, Direction.debit
    return AccountNature.income, Direction.credit


def _signed_totals(db, sides: dict[int, Direction]) -> dict[int, Decimal]:
    from src.models.ledger import LedgerLine
    totals: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    for line in db.scalars(select(LedgerLine)).all():
        amt = Decimal(line.amount or 0)
        side = sides.get(line.account_id)
        if side is None:
            continue
        totals[line.account_id] += amt if line.direction == side else -amt
    return totals


def _statements(totals: dict[int, Decimal], natures: dict[int, AccountNature | None]):
    inc = sum((v for a, v in totals.items() if natures.get(a) == AccountNature.income), Decimal("0"))
    exp = sum((v for a, v in totals.items() if natures.get(a) == AccountNature.expense), Decimal("0"))
    ast = sum((v for a, v in totals.items() if natures.get(a) == AccountNature.asset), Decimal("0"))
    lia = sum((v for a, v in totals.items() if natures.get(a) == AccountNature.liability), Decimal("0"))
    equ = sum((v for a, v in totals.items() if natures.get(a) == AccountNature.equity), Decimal("0"))
    profit = inc - exp
    return {"income": inc, "expenses": exp, "profit": profit, "assets": ast,
            "liabilities": lia, "equity": equ,
            "balanced": ast == lia + equ + profit}


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        accounts = db.scalars(select(Account)).all()
        groups = {a.id: a for a in accounts if a.code and _CODE_RE.match(a.code) and _CODE_RE.match(a.code).group(2) == "M"}
        subs = [a for a in accounts if a.code and _CODE_RE.match(a.code) and _CODE_RE.match(a.code).group(2) == "S"]

        plan: dict[int, tuple[AccountNature, Direction]] = {}
        unknown: list[str] = []
        for g in groups.values():
            m = _CODE_RE.match(g.code)
            tgt = target_for_group(int(m.group(3)), _branch_of(g.code), g.name or "")
            if tgt is None:
                unknown.append(f"{g.code} «{g.name}»")
            else:
                plan[g.id] = tgt
        for s in subs:
            parent = db.get(Account, s.parent_id) if s.parent_id else None
            if parent is not None and parent.id in plan:
                plan[s.id] = plan[parent.id]
            else:
                unknown.append(f"{s.code} «{s.name}» (أبوه مش مجموعة a5)")

        cur_sides = {a.id: a.normal_side for a in accounts}
        from src.services.chart_service import _NATURE_BY_TYPE
        cur_natures = {a.id: (a.nature or _NATURE_BY_TYPE.get(a.account_type))
                       for a in accounts}
        totals = _signed_totals(db, cur_sides)
        before = _statements(totals, cur_natures)

        new_sides = dict(cur_sides)
        new_natures = dict(cur_natures)
        changes = 0
        for aid, (nat, side) in plan.items():
            acc = db.get(Account, aid)
            if acc.nature != nat or acc.normal_side != side:
                changes += 1
            new_sides[aid] = side
            new_natures[aid] = nat
        after = _statements(_signed_totals(db, new_sides), new_natures)

        print(f"مجموعات a5: {len(groups)}   فرعية: {len(subs)}   هيتغيّر: {changes}")
        print("\nقائمة الدخل:")
        print(f"   إيرادات        قبل {before['income']:>16,.2f}   بعد {after['income']:>16,.2f}")
        print(f"   مصروفات        قبل {before['expenses']:>16,.2f}   بعد {after['expenses']:>16,.2f}")
        print(f"   صافي الربح     قبل {before['profit']:>16,.2f}   بعد {after['profit']:>16,.2f}")
        print("\nالميزانية:")
        print(f"   أصول           قبل {before['assets']:>16,.2f}   بعد {after['assets']:>16,.2f}")
        print(f"   التزامات       قبل {before['liabilities']:>16,.2f}   بعد {after['liabilities']:>16,.2f}")
        print(f"   حقوق ملكية     قبل {before['equity']:>16,.2f}   بعد {after['equity']:>16,.2f}")
        gap_before = before["assets"] - before["liabilities"] - before["equity"] - before["profit"]
        gap_after = after["assets"] - after["liabilities"] - after["equity"] - after["profit"]
        print(f"   العجز (أصول−التزامات−ملكية−ربح): قبل {gap_before:>16,.2f}   بعد {gap_after:>16,.2f}")

        moving = [(db.get(Account, aid), totals.get(aid, Decimal("0")), nat, side)
                  for aid, (nat, side) in plan.items()
                  if (acc := db.get(Account, aid)) and (acc.nature != nat or acc.normal_side != side)]
        moving.sort(key=lambda r: -abs(r[1]))
        if moving:
            print("\nأكبر حسابات هتتغيّر (الرصيد الحالي الموقّع):")
            for acc, bal, nat, side in moving[:12]:
                print(f"   {acc.code:<12}«{(acc.name or '')[:34]:<34}» {str(acc.nature):<22}→ {nat.value}/{side.value}  {bal:>14,.2f}")
            if len(moving) > 12:
                print(f"   ... و{len(moving) - 12} غيرهم")

        for acc in accounts:
            if acc.name and "مخصومة عند المنبع" in acc.name:
                print(f"\n⚠️ للمراجعة: {acc.code} «{acc.name}» رصيده {totals.get(acc.id, 0):,.2f} وداخل مصروف (نوع a5=٣ رغم MTree=التزامات).")

        if unknown:
            print(f"\n⚠️ {len(unknown)} حساب مش في الخريطة — مش هيتلمس:")
            for u in unknown[:10]:
                print(f"   {u}")
            if len(unknown) > 10:
                print(f"   ... و{len(unknown) - 10} غيرهم")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        if abs(gap_after) > abs(gap_before):
            print("\n✘ العجز المتوقع أكبر من الحالي — مافيش حاجة اتكتبت. راجع الأرقام الأول.")
            raise SystemExit(1)

        for aid, (nat, side) in plan.items():
            acc = db.get(Account, aid)
            acc.nature = nat
            acc.normal_side = side
        db.commit()
        print(f"\n✔ اتصحّح {changes} حساب.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
