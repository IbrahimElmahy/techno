"""البنود التحليلية — كل حصة مركز تكلفة كسطر، زي `account.analytic.line` في أودو.

تقرير «أرباح مراكز التكلفة» بيقول إن المركز ده اتحمّل ٣٢٥ جنيه. السؤال اللي بيتسأل
بعده على طول هو **«من إيه؟»** — وده رقم مجمّع، والإجابة قايمة. من غيرها اللي شايف
رقم مش مقتنع بيه مالوش طريق يراجعه غير إنه يفتح القيود واحد واحد ويدوّر على اللي
عليه المركز.

**بنشتقّها مش بنخزّنها.** أودو بيكتب صف تحليلي جنب كل سطر قيد، فبيبقى عنده جدولين
لازم يفضلوا متفقين. عندنا الحصة في `ledger_line_distribution` والسطر الواحد على
`ledger_line.cost_center_id`، والاتنين بيتقروا من `analytic_service.shares_of` —
نفس الباب اللي التقارير بتعدّي منه. فالقايمة دي **هي نفسها** الأرقام اللي في تقرير
الربحية، مش جدول تاني ممكن يختلف معاه.

السطر اللي حسابه مش إيراد ولا مصروف بيتشال: ده تقرير تحليلي، وحركة الأصول مش ربح
ولا خسارة. نفس شرط تقرير الربحية بالظبط عشان الرقمين مايختلفوش.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.lib.analysis_reports import _pnl_lines
from src.models.cost_center import CostCenter
from src.services import analytic_service, move_registry


def analytic_items(
    db: Session,
    *,
    cost_center_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    include_unassigned: bool = False,
) -> dict:
    """كل حصة في الفترة كسطر، ومعاها مجموعها.

    `cost_center_id` بيضيّق على مركز واحد — ده الاستعمال الأساسي: جاي من صف في
    تقرير الربحية بيسأل «الرقم ده جه منين».
    """
    rows_in = list(_pnl_lines(db, date_from=date_from, date_to=date_to))
    dists = analytic_service.distributions_for(db, [ln.id for ln, _n, _s in rows_in])
    names = {c.id: c.name for c in db.scalars(select(CostCenter)).all()}

    items: list[dict] = []
    total = ZERO
    for line, nature, signed in rows_in:
        for key, part in analytic_service.shares_of(line, signed, dists.get(line.id)):
            if key is None and not include_unassigned:
                continue
            if cost_center_id is not None and key != cost_center_id:
                continue
            if part == ZERO:
                continue
            entry = line.entry
            items.append({
                "line_id": line.id,
                "entry_id": entry.id,
                "entry_number": entry.number,
                "entry_date": str(entry.entry_date or entry.created_at.date()),
                "move_type_label": move_registry.MOVE_TYPE_LABEL.get(entry.move_type or ""),
                "description": entry.description or "",
                "statement": line.statement,
                "account_id": line.account_id,
                "account_code": line.account.code,
                "account_name": line.account.name or line.account.account_type.value,
                "nature": nature.value,
                "cost_center_id": key,
                "cost_center_name": names.get(key) if key else "— غير موزّع —",
                # حصة السطر بإشارة طبيعته: الإيراد موجب والمصروف موجب، زي تقرير الربحية.
                "amount": str(to_money(part)),
                # نصيب المركز من السطر — ١٠٠٪ لما يكون السطر كله عليه.
                "share_pct": str(to_money(
                    Decimal(str(part)) / Decimal(str(signed)) * 100)) if signed else None,
            })
            total = to_money(total + part)

    items.sort(key=lambda r: (r["entry_date"], r["entry_id"], r["line_id"]), reverse=True)
    return {
        "cost_center_id": cost_center_id,
        "date_from": str(date_from) if date_from else None,
        "date_to": str(date_to) if date_to else None,
        "items": items,
        "totals": {"items": len(items), "amount": str(total)},
    }
