"""صنف a5 ⇐ صنفنا: جدول الربط الأول، وبعده الكود والاسم زي ما كان (٢٠٢٦-١٠-٠٧).

كل سكربتات المزامنة كانت بتعمل نفس السطر:

    item_by_code.get(f"{prefix}{code}") or item_by_name.get(name)

وده بيقع أول ما التوحيد يغيّر الكود أو الاسم عندنا. هنا نفس السؤال بإجابة واحدة لكل
السكربتات: `A5ItemLink` الأول (الكود، وبعده الاسم للي مالوش كود)، وبعدين الطريقة القديمة
للصنف اللي لسه ماتربطش — والصنف اللي اتلقى كده بيتربط (`remember`) فالمرة الجاية
مابيعتمدش على الاسم.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.a5_link import A5ItemLink
from src.models.catalog import Item


def _c(v) -> str:
    return " ".join(str(v or "").split())


class A5ItemMap:
    def __init__(self, db: Session, prefix: str, my_items: list[Item]) -> None:
        self.db = db
        self.prefix = prefix
        self.by_code = {i.code: i for i in my_items if i.code}
        self.by_name = {i.name: i for i in my_items}
        self._items: dict[int, Item] = {i.id: i for i in my_items}
        self.link_code: dict[str, int] = {}
        self.link_name: dict[str, int] = {}
        for ln in db.scalars(select(A5ItemLink).where(A5ItemLink.prefix == prefix)):
            if ln.a5_code:
                self.link_code.setdefault(ln.a5_code, ln.item_id)
            else:
                self.link_name.setdefault(ln.a5_name, ln.item_id)

    def _item(self, item_id: int) -> Item | None:
        it = self._items.get(item_id)
        if it is None:
            it = self.db.get(Item, item_id)
            if it is not None:
                self._items[item_id] = it
        return it

    def linked(self, code, name) -> Item | None:
        """الربط بس — من غير الرجوع للكود والاسم."""
        code, name = _c(code), _c(name)
        iid = self.link_code.get(code) if code else self.link_name.get(name)
        return self._item(iid) if iid else None

    def find(self, code, name) -> Item | None:
        code, name = _c(code), _c(name)
        hit = self.linked(code, name)
        if hit is not None:
            return hit
        return self.by_code.get(f"{self.prefix}{code}") or self.by_name.get(name)

    def remember(self, code, name, item: Item, a5_item_id: int | None = None) -> bool:
        """يربط صنف a5 بصنفنا لو لسه مش مربوط. بيرجّع True لو اتعمل ربط جديد."""
        code, name = _c(code), _c(name)
        if not (code or name) or item is None or item.id is None:
            return False
        if (code and code in self.link_code) or (not code and name in self.link_name):
            return False
        self.db.add(A5ItemLink(prefix=self.prefix, a5_code=code[:64], a5_name=name[:255],
                               a5_item_id=a5_item_id, item_id=item.id))
        if code:
            self.link_code[code] = item.id
        else:
            self.link_name[name] = item.id
        self._items[item.id] = item
        return True

    def find_or_remember(self, code, name, a5_item_id: int | None = None) -> Item | None:
        it = self.find(code, name)
        if it is not None:
            self.remember(code, name, it, a5_item_id)
        return it


def relink(db: Session, *, from_item_id: int, to_item_id: int) -> int:
    """دمج صنفين عندنا ⇐ ربط a5 بتاع القديم بيتحوّل للموحّد. بيرجّع عدد الروابط."""
    rows = db.scalars(select(A5ItemLink).where(A5ItemLink.item_id == from_item_id)).all()
    for r in rows:
        r.item_id = to_item_id
    db.flush()
    return len(rows)
