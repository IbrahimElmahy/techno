from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.lib.stock_docs import canonical
from src.models.ledger import Direction
from src.models.org import Branch
from src.models.perpetual import InventoryAccount, InventoryPosting
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.warehouse import Warehouse

ENTRY_TYPE = "inventory"
MOVEMENT_DOCS = ("stock_transfer", "stock_permit", "stock_count", "manufacturing_order",
                 "production_order", "wastage")
PRODUCTION_DOCS = ("manufacturing_order", "production_order")
DOC_LABEL = {
    "stock_transfer": "تحويل مخزني", "stock_permit": "إذن مخزني", "stock_count": "جرد",
    "manufacturing_order": "تصنيع", "production_order": "أمر تشغيل", "wastage": "هالك",
}


def perpetual_from(db: Session, branch_id: int | None) -> date | None:
    if not branch_id:
        return None
    return db.scalar(select(Branch.perpetual_from).where(Branch.id == branch_id))


def is_active(db: Session, branch_id: int | None, day: date | None) -> bool:
    start = perpetual_from(db, branch_id)
    return start is not None and (day or date.today()) >= start


def accounts(db: Session, branch_id: int) -> dict[str, int]:
    return {r.role: r.account_id for r in db.scalars(
        select(InventoryAccount).where(InventoryAccount.branch_id == branch_id)).all()}


def location_role(db: Session, kind, location_id: int | None) -> str | None:
    kind = getattr(kind, "value", kind)
    if not location_id:
        return None
    if kind == LocationKind.custody.value:
        return "finished"
    if kind != LocationKind.warehouse.value:
        return None
    return db.scalar(select(Warehouse.inventory_role).where(Warehouse.id == location_id))


def location_account(db: Session, branch_id: int, kind, location_id: int | None) -> int | None:
    role = location_role(db, kind, location_id)
    return accounts(db, branch_id).get(role) if role else None


def _day(mv: StockMovement) -> date:
    return mv.movement_date or mv.created_at.date()


def _costs(db: Session, moves: list[StockMovement]) -> dict[tuple[int, date], Decimal]:
    from src.services import costing_service

    wanted = {(m.item_id, _day(m)) for m in moves if m.unit_cost is None}
    out: dict[tuple[int, date], Decimal] = {}
    by_day: dict[date, set[int]] = defaultdict(set)
    for item_id, day in wanted:
        by_day[day].add(item_id)
    for day, ids in by_day.items():
        found = costing_service.known_costs(db, ids, as_of=day)
        for i in ids:
            out[(i, day)] = Decimal(str(found.get(i) or 0))
    return out


def _value(mv: StockMovement, costs) -> Decimal:
    unit = (Decimal(str(mv.unit_cost)) if mv.unit_cost is not None
            else costs.get((mv.item_id, _day(mv)), ZERO))
    return to_money(Decimal(str(mv.quantity)) * unit)


def _planned_output(db: Session, doc_type: str, doc_id: int) -> Decimal | None:
    if doc_type != "production_order":
        return None
    from src.models.manufacturing import ProductionOrderProduct

    rows = db.scalars(select(ProductionOrderProduct.quantity).where(
        ProductionOrderProduct.order_id == doc_id)).all()
    total = sum((Decimal(str(q or 0)) for q in rows), Decimal("0"))
    return total if total > 0 else None


def _lines_for(db: Session, doc_type: str, doc_id: int, branch_id: int,
               start: date) -> tuple[dict[int, Decimal], date | None]:
    names = [doc_type, f"reverse_{doc_type}"]
    if doc_type == "manufacturing_order":
        names += ["manufacturing", "reverse_manufacturing"]
    moves = [m for m in db.scalars(select(StockMovement).where(
        StockMovement.source_doc_type.in_(names), StockMovement.source_doc_id == doc_id)).all()
        if _day(m) >= start]
    if not moves:
        return {}, None
    accs = accounts(db, branch_id)
    costs = _costs(db, moves)
    net: dict[int, Decimal] = defaultdict(lambda: ZERO)
    production = doc_type in PRODUCTION_DOCS

    def sign(mv: StockMovement) -> Decimal:
        return Decimal(1) if mv.direction == StockDirection.in_ else Decimal(-1)

    def account_of(mv: StockMovement, default_role: str) -> int | None:
        return accs.get(location_role(db, mv.location_kind, mv.location_id) or "")             or accs.get(default_role)

    products = [m for m in moves if production and "production" in (m.movement_type or "")]
    others = [m for m in moves if m not in products]
    consumed = ZERO
    for mv in others:
        value = sign(mv) * _value(mv, costs)
        net[account_of(mv, "adjust")] += value
        consumed -= value
    if products:
        by_place: dict[tuple, Decimal] = defaultdict(lambda: Decimal("0"))
        for mv in products:
            by_place[(mv.location_kind, mv.location_id)] += sign(mv) * Decimal(str(mv.quantity))
        made = sum((q for q in by_place.values() if q > 0), Decimal("0"))
        planned = _planned_output(db, doc_type, doc_id) or made
        share = min(Decimal(1), made / planned) if planned and made > 0 else Decimal(0)
        finished = to_money(max(consumed, ZERO) * share)
        places = [(k, q) for k, q in by_place.items() if q > 0]
        for (kind, loc), part in zip(places, allocate(finished, [q for _, q in places])):
            acc = accs.get(location_role(db, kind, loc) or "") or accs.get("finished")
            net[acc] += part
    balance = sum(net.values(), ZERO)
    if balance != ZERO:
        net[accs.get("wip") if production else accs.get("adjust")] -= balance
    day = max(_day(m) for m in moves)
    return {a: to_money(v) for a, v in net.items() if a and to_money(v) != ZERO}, day


def _doc_branch(db: Session, doc_type: str, doc_id: int) -> int | None:
    from src.models.stock import StockMovement as M

    return db.scalar(select(M.branch_id).where(
        M.source_doc_type.in_([doc_type, f"reverse_{doc_type}"]), M.source_doc_id == doc_id,
        M.branch_id.is_not(None)).limit(1))


def sync_doc(db: Session, doc_type: str, doc_id: int, *, actor_user_id: int | None = None) -> None:
    doc_type = canonical(doc_type) or doc_type
    if doc_type.startswith("reverse_"):
        doc_type = doc_type[len("reverse_"):]
    if doc_type == "manufacturing":
        doc_type = "manufacturing_order"
    if doc_type not in MOVEMENT_DOCS:
        return
    posting = db.scalar(select(InventoryPosting).where(
        InventoryPosting.doc_type == doc_type, InventoryPosting.doc_id == doc_id))
    branch_id = (posting.branch_id if posting is not None else None) \
        or _doc_branch(db, doc_type, doc_id)
    start = perpetual_from(db, branch_id)
    if posting is None and start is None:
        return
    if posting is not None and posting.ledger_entry_id:
        from src.services.document_edit_service import _drop_entry

        entry_id = posting.ledger_entry_id
        posting.ledger_entry_id = None
        db.flush()
        _drop_entry(db, entry_id)
    if start is None:
        if posting is not None:
            db.delete(posting)
        db.flush()
        return
    net, day = _lines_for(db, doc_type, doc_id, branch_id, start)
    if not net:
        if posting is not None:
            db.delete(posting)
        db.flush()
        return
    from src.services import ledger_service
    from src.services.ledger_service import LineInput

    label = DOC_LABEL.get(doc_type, doc_type)
    lines = [LineInput(acc, Direction.debit if v > 0 else Direction.credit, abs(v),
                       statement=f"قيد مخزني — {label} #{doc_id}") for acc, v in net.items()]
    actor = actor_user_id or _system_actor(db)
    entry = ledger_service.post_entry(
        db, entry_type=ENTRY_TYPE, actor_user_id=actor, lines=lines, branch_id=branch_id,
        description=f"قيد مخزني — {label} #{doc_id}", entry_date=day)
    if posting is None:
        posting = InventoryPosting(doc_type=doc_type, doc_id=doc_id, branch_id=branch_id)
        db.add(posting)
    posting.ledger_entry_id = entry.id
    db.flush()


def _system_actor(db: Session) -> int:
    from src.models.role import Role, RoleName
    from src.models.user import User

    return db.scalar(select(User.id).join(Role, Role.id == User.role_id)
                     .where(Role.name == RoleName.system_admin).order_by(User.id))


def split_by_location(db: Session, branch_id: int, parts: list[tuple[object, int | None, Decimal]],
                      fallback_account_id: int) -> dict[int, Decimal]:
    out: dict[int, Decimal] = defaultdict(lambda: ZERO)
    for kind, location_id, value in parts:
        acc = location_account(db, branch_id, kind, location_id) or fallback_account_id
        out[acc] += value
    return {a: to_money(v) for a, v in out.items() if to_money(v) != ZERO}


def allocate(total: Decimal, weights: list[Decimal]) -> list[Decimal]:
    total = to_money(total)
    whole = sum(weights, ZERO)
    if not weights:
        return []
    if whole == ZERO:
        return [total] + [ZERO] * (len(weights) - 1)
    out = [to_money(total * w / whole) for w in weights]
    out[-1] = to_money(out[-1] + total - sum(out, ZERO))
    return out


def stock_side(db: Session, branch_id: int | None, day: date | None, parts, total: Decimal,
               fallback_account_id: int, direction: Direction) -> list:
    from src.services.ledger_service import LineInput

    total = to_money(total)
    if total <= ZERO:
        return []
    if not is_active(db, branch_id, day):
        return [LineInput(fallback_account_id, direction, total)]
    parts = list(parts)
    shares = allocate(total, [Decimal(str(w or 0)) for _, _, w in parts]) if parts else [total]
    by_acc = split_by_location(
        db, branch_id, [(k, loc, s) for (k, loc, _), s in zip(parts, shares)] if parts
        else [(None, None, total)], fallback_account_id)
    return [LineInput(acc, direction, v) for acc, v in by_acc.items()]


def cogs_lines(db: Session, branch_id: int | None, day: date | None, parts,
               *, reverse: bool = False) -> list:
    from src.services.ledger_service import LineInput

    if not is_active(db, branch_id, day):
        return []
    accs = accounts(db, branch_id)
    cogs = accs.get("cogs")
    if cogs is None:
        return []
    by_acc: dict[int, Decimal] = defaultdict(lambda: ZERO)
    for kind, loc, value in parts:
        value = to_money(value)
        if value <= ZERO:
            continue
        acc = location_account(db, branch_id, kind, loc) or accs.get("finished")
        by_acc[acc] += value
    total = to_money(sum(by_acc.values(), ZERO))
    if total <= ZERO:
        return []
    stock_dir, cogs_dir = ((Direction.debit, Direction.credit) if reverse
                           else (Direction.credit, Direction.debit))
    lines = [LineInput(cogs, cogs_dir, total, statement="تكلفة المبيعات")]
    lines += [LineInput(acc, stock_dir, to_money(v), statement="تكلفة المبيعات")
              for acc, v in by_acc.items()]
    return lines
