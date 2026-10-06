"""Units of measure (008, T005).

Resolves a document line's unit to a conversion factor (base units per one of the chosen unit). The
base unit is item.unit_of_measure with an implicit factor of 1; alternates live in item_unit. Stock is
always posted in the base unit = entered quantity × factor.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import to_factor, to_qty
from src.models.catalog import Item, ItemUnit

ONE = Decimal("1")

# ── طول القطعة: «القطعة = N متر» ─────────────────────────────────────────────────────
#
# المواسير بتتباع بالقطعة وبالمتر، والفرع هو اللي بيقرر: المصنع شغّال متر، والفروع ممكن
# قطعة. فمافيش وحدة واحدة تتفرض على الكل — كل صنف بيقول قطعته كام متر، والسطر بيختار.
#
# ومافيش آلية جديدة: ده صف وحدة بديلة عادي في `item_unit` (008)، فالبيع والمرتجع والشرا
# بيحوّلوه بنفس `resolve_factor` من غير ما حد فيهم يعرف إن فيه «طول». الفرق كله في
# اتجاه المعامل، وده بيتحدد من الوحدة الأساسية للصنف — لأن المخزن بيتعدّ بيها:
#
#   أساسه متر  (كروت «متر مواسير» في المصنع) ⇒ وحدة «قطعة» معاملها N
#       بيع ٥٠ قطعة × ٣ = ١٥٠ متر بتنزل من المخزن — حساب مظبوط من غير كسور.
#   أساسه قطعة (كروت العلياء «م 6"*4 110»)   ⇒ وحدة «متر» معاملها ١÷N
#       بيع ١٥٠ متر × (١÷٣) = ٥٠ قطعة.
#
# ⚠️ **الباقي في الاتجاه التاني.** المخزن بيتعدّ بـ٣ منازل، فمتر واحد من ماسورة ٣ متر =
# ٠٫٣٣٣ قطعة. تلات سطور متر متر متر بيخصموا ٠٫٩٩٩ ويفضل ٠٫٠٠١ قطعة في الرصيد، بينما
# سطر واحد «٣ متر» بيخصم ١٫٠٠٠ بالظبط. ده حد عمود الكمية مش غلطة حساب — والمعامل نفسه
# بـ٩ منازل (`FACTOR`) فمابيضيفش غلط من عنده. الصنف اللي بيتباع بالمتر كتير أنضف إن
# أساسه يبقى متر.
METER = "متر"
PIECE = "قطعة"
_PIECE_NAMES = {"قطعة", "قطعه"}


def _norm(label: str | None) -> str:
    return (label or "").strip()


def is_meter_unit(label: str | None) -> bool:
    """«متر» وأشكاله («م»، «متر طولي»…) — الوحدة اللي الطول بيتقاس بيها."""
    t = _norm(label)
    return t == "م" or t.startswith("متر")


def length_unit(base_unit: str, meters_per_piece: Decimal) -> tuple[str, Decimal]:
    """الوحدة البديلة اللي بتقول «القطعة = N متر» لصنف وحدته الأساسية `base_unit`.

    أساسه متر ⇒ («قطعة»، N). أي أساس تاني (قطعة، ماسورة، لفة…) ⇒ («متر»، ١÷N) —
    والقسمة هنا بـDecimal وبتتقرّب لـ٩ منازل مرة واحدة، مش ١÷N متقرّبة لـ٣ وبعدين مضروبة.
    """
    n = Decimal(str(meters_per_piece))
    if n <= 0:
        raise UomError("طول القطعة لازم يكون أكبر من صفر.")
    if is_meter_unit(base_unit):
        return PIECE, to_factor(n)
    return METER, to_factor(ONE / n)


def _is_length_row(base_unit: str, name: str) -> bool:
    if is_meter_unit(base_unit):
        return _norm(name) in _PIECE_NAMES
    return is_meter_unit(name)


def meters_per_piece(base_unit: str, rows) -> Decimal | None:
    """طول القطعة المتسجّل على الصنف، أو None لو مالوش.

    في اتجاه «أساسه قطعة» المعامل ١÷N بـ٩ منازل، فـ١÷المعامل بيطلع N ± حاجة صغيرة جداً
    والتقريب لـ٣ منازل بيرجّعها N زي ما اتكتبت.
    """
    for r in rows:
        f = Decimal(str(r.factor or 0))
        if f > 0 and _is_length_row(base_unit, r.name):
            return to_qty(f if is_meter_unit(base_unit) else ONE / f)
    return None


def apply_length(db: Session, item: Item, length: Decimal | None) -> None:
    """يكتب «القطعة = N متر» على الصنف (أو يشيله لو `length` فاضي/صفر).

    بيشيل أي صف طول قديم الأول — من الاتجاهين، لأن الوحدة الأساسية ممكن تكون لسه
    متصلّحة من «قطعة» لـ«متر» (أو العكس) فالصف القديم بقى بالاتجاه الغلط أو بقى بنفس
    اسم الأساس. الوحدات التانية (كرتونة…) مابتتلمسش.
    """
    base = item.unit_of_measure
    kept: list[str] = []
    for r in db.scalars(select(ItemUnit).where(ItemUnit.item_id == item.id)).all():
        name = _norm(r.name)
        if (is_meter_unit(name) or name == _norm(base)
                or (is_meter_unit(base) and name in _PIECE_NAMES)):
            db.delete(r)
        else:
            kept.append(name)
    db.flush()
    if length is None or Decimal(str(length)) <= 0:
        return
    name, factor = length_unit(base, Decimal(str(length)))
    if name in kept:
        raise UomError(f"الصنف عليه وحدة اسمها «{name}» بالفعل.")
    db.add(ItemUnit(item_id=item.id, name=name, factor=factor))
    db.flush()


class UomError(Exception):
    """Unknown unit for an item."""


def resolve_factor(db: Session, item: Item, unit: str | None) -> Decimal:
    """Base/None → 1; an alternate unit → its factor; otherwise UomError."""
    if unit is None or unit == item.unit_of_measure:
        return ONE
    row = db.scalar(
        select(ItemUnit).where(ItemUnit.item_id == item.id, ItemUnit.name == unit)
    )
    if row is None:
        raise UomError(f"الوحدة «{unit}» مش معرّفة للصنف ده.")
    # `to_factor` مش `to_qty`: معامل «متر» لصنف أساسه قطعة ٣ متر هو ٠٫٣٣٣٣٣٣٣٣٣، وتقريبه
    # لـ٣ منازل كان بيخصم ٤٩٫٩٥ قطعة على بيع ١٥٠ متر.
    return to_factor(row.factor)
