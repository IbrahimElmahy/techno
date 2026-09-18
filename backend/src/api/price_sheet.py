"""كشف التسعير — كل أصناف النظام بأسعارها وخصوماتها، من غير كميات.

فاتورة البيع بتجاوب «التاجر ده هياخد الكمية دي بكام». الكشف ده بيجاوب سؤال تاني:
«الصنف ده بكام عندي، بكل الشرائح؟» — ورقة بتتطبع وتتبعت للتاجر قبل ما يطلب.

**مافيش كميات ومافيش حدود.** الكشف مش مستند: مابيحجزش بضاعة ومابيخصمش مخزون
ومابيدخلش الدفتر. فالصنف اللي رصيده صفر بيفضل فيه — التاجر بيسأل عن السعر قبل ما
البضاعة توصل، والورقة اللي بتخفي الصنف الفاضي بتخلّيه يسأل على التليفون.

**وبيرجع الشرايح الستة كلها في نداء واحد.** الفاتورة بتختار شريحة التاجر وتعرض
سعرها، والكشف بيعرض الشبكة كاملة عشان اللي بيسعّر يقارن — وده الفرق بين الشاشتين.
`item_price` هو المصدر مش `item.sale_price`: الاتنين بيتفقوا وقت إنشاء الصنف، لكن
شبكة الشرايح بتتعدّل لوحدها بعدين، وهي اللي بتتحاسب فعلاً.

الخصم على السطر بيتقرا من `item.default_discount_pct`، وهو نفس الرقم اللي بيتقترح
على سطر الفاتورة — فالورقة بتقول اللي الفاتورة هتعمله بالظبط.
"""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_CATALOG_READ
from src.core.db import get_db
from src.lib import arabic
from src.models.catalog import Item, ItemPrice, PriceTier
from src.services import item_profile_service

router = APIRouter(tags=["price-sheet"])

# ترتيب الشرايح زي ما بتتقري على الورق: من أغلى تاجر لأرخصه، والمستهلك في الآخر.
TIER_ORDER: list[PriceTier] = [
    PriceTier.list_price,
    PriceTier.commercial,
    PriceTier.semi_commercial,
    PriceTier.wholesale,
    PriceTier.semi_wholesale,
    PriceTier.consumer,
]

TIER_LABELS: dict[str, str] = {
    "list_price": "سعر اللستة",
    "commercial": "تجارى",
    "semi_commercial": "نصف تجارى",
    "wholesale": "جملة",
    "semi_wholesale": "نصف جملة",
    "consumer": "مستهلك",
}


class PriceRow(BaseModel):
    item_id: int
    code: str
    name: str
    category: str | None = None
    unit: str
    # الشريحة → السعر. الشريحة اللي مالهاش صف بتغيب — **مش بتتحط صفر**: الخانة
    # الفاضية معناها «مش بيتباع بالشريحة دي»، والصفر معناه «ببلاش».
    prices: dict[str, Decimal] = {}
    # الخصم المقترح على سطر الفاتورة لنفس الصنف.
    discount_pct: Decimal = Decimal("0")
    # السعر بعد الخصم لكل شريحة — عشان اللي بيقرا مايحسبش بإيده.
    net_prices: dict[str, Decimal] = {}
    on_hand: Decimal | None = None


class PriceSheetOut(BaseModel):
    tiers: list[dict] = []
    rows: list[PriceRow] = []
    count: int = 0


@router.get("/price-sheet", response_model=PriceSheetOut)
def price_sheet(
    q: str | None = Query(default=None, description="بحث بالاسم أو الكود"),
    category: str | None = None,
    with_stock: bool = Query(default=False, description="يزوّد الرصيد الحالي"),
    active_only: bool = True,
    _: CurrentUser = Depends(require_capability(CAP_CATALOG_READ)),
    db: Session = Depends(get_db),
) -> PriceSheetOut:
    """كل الأصناف بأسعارها. **من غير `limit`** — الكشف بيتطبع كامل.

    الترقيم هنا كان هيبقى فخ: ورقة تسعير ناقصة بتوصل للتاجر وهو مش عارف إنها ناقصة،
    وبيسأل على صنف مش فيها فيتقاله «مش عندنا». الكتالوج ٢٬٦٣٠ صنف — نداء واحد.
    """
    stmt = select(Item)
    if active_only:
        stmt = stmt.where(Item.active.is_(True))
    if category:
        stmt = stmt.where(Item.category == category)
    if q:
        # نفس تطبيع الفرز على الوشين: الهمزة والتاء المربوطة مايفرّقوش الاسم الواحد،
        # فاللي بيدوّر على «جلبه» يلاقي «جلبة».
        needle = f"%{arabic.bare(q)}%"
        stmt = stmt.where(arabic.sort_key(Item.name).like(needle)
                          | Item.code.ilike(f"%{q}%"))
    stmt = stmt.order_by(arabic.sort_key(Item.name), Item.name)
    items = list(db.scalars(stmt).all())
    ids = [i.id for i in items]

    # كل الشرايح في استعلام واحد — بدل ستة، واحد لكل شريحة.
    by_item: dict[int, dict[str, Decimal]] = {}
    if ids:
        for item_id, tier, price in db.execute(
            select(ItemPrice.item_id, ItemPrice.tier, ItemPrice.price)
            .where(ItemPrice.item_id.in_(ids))
        ).all():
            key = tier.value if hasattr(tier, "value") else str(tier)
            by_item.setdefault(item_id, {})[key] = Decimal(str(price))

    on_hand = item_profile_service.bulk_on_hand(db, ids) if with_stock else {}

    rows: list[PriceRow] = []
    for item in items:
        prices = by_item.get(item.id, {})
        # الصنف اللي مالوش شبكة شرايح بيرجع بسعره الأساسي تحت «سعر اللستة» — ده
        # أحسن من صف فاضي تماماً على ورقة تسعير، واللي بيقرا بيشوف رقم واحد على
        # الأقل يبدأ منه.
        if not prices and item.sale_price is not None:
            prices = {PriceTier.list_price.value: Decimal(str(item.sale_price))}
        discount = Decimal(str(item.default_discount_pct or 0))
        factor = (Decimal("100") - discount) / Decimal("100")
        rows.append(PriceRow(
            item_id=item.id, code=item.code, name=item.name,
            category=item.category, unit=item.unit_of_measure,
            prices=prices, discount_pct=discount,
            net_prices={k: (v * factor).quantize(Decimal("0.01"))
                        for k, v in prices.items()},
            on_hand=on_hand.get(item.id) if with_stock else None,
        ))

    return PriceSheetOut(
        tiers=[{"key": t.value, "label": TIER_LABELS[t.value]} for t in TIER_ORDER],
        rows=rows, count=len(rows),
    )
