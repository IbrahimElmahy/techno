from __future__ import annotations

import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.party_link import PartyGroup, PartyGroupMember
from src.models.supplier import Supplier
from src.services import audit_service, customer_merge_service


def run(*, execute: bool, actor: int) -> None:
    db = SessionLocal()
    try:
        member_group = {(m.kind, m.ref_id): m.group_id for m in db.scalars(select(PartyGroupMember))}
        suppliers = [s for s in db.scalars(select(Supplier).where(Supplier.active.is_(True)))]
        by_key: dict[tuple, list[Supplier]] = {}
        for s in suppliers:
            by_key.setdefault((s.branch_id, customer_merge_service.match_key(s.name)), []).append(s)
        sup_by_id = {s.id: s for s in suppliers}

        pairs: list[tuple[Customer, Supplier, str]] = []
        for c in db.scalars(select(Customer).where(Customer.active.is_(True)).order_by(Customer.id)):
            if c.customer_type == "employee" or c.name.startswith("@@"):
                continue
            if c.supplier_id and c.supplier_id in sup_by_id:
                pairs.append((c, sup_by_id[c.supplier_id], "ربط سابق"))
                continue
            hits = by_key.get((c.branch_id, customer_merge_service.match_key(c.name))) or []
            if len(hits) == 1:
                pairs.append((c, hits[0], "نفس الاسم والفرع"))

        created = joined = 0
        for c, s, why in pairs:
            cg = member_group.get(("customer", c.id))
            sg = member_group.get(("supplier", s.id))
            if cg and sg:
                continue
            gid = cg or sg
            if gid is None:
                g = PartyGroup(name=s.name if c.customer_type == "internal" else c.name,
                               branch_id=c.branch_id or s.branch_id)
                db.add(g)
                db.flush()
                gid = g.id
                created += 1
            else:
                joined += 1
            for kind, ref in (("customer", c.id), ("supplier", s.id)):
                if (kind, ref) not in member_group:
                    db.add(PartyGroupMember(group_id=gid, kind=kind, ref_id=ref))
                    member_group[(kind, ref)] = gid
            print(f"{why}: {c.code} {c.name}  ⇄  {s.code} {s.name}")
        db.flush()
        audit_service.record(db, action="party.auto_link", actor_user_id=actor,
                             entity_type="party_group", entity_id=None,
                             after={"created": created, "joined": joined})
        print(f"أطراف جديدة: {created} · كروت انضمت لطرف موجود: {joined}")
        if execute:
            db.commit()
            print("اتحفظ.")
        else:
            db.rollback()
            print("تجربة فقط — أضف --yes للحفظ.")
    finally:
        db.close()


if __name__ == "__main__":
    actor_arg = next((a for a in sys.argv if a.startswith("--actor=")), "--actor=1")
    run(execute="--yes" in sys.argv, actor=int(actor_arg.split("=")[1]))
