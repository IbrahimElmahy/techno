from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from src.models.contact import ContactPhone, PhoneOwner


def list_phones(db: Session, owner_type: PhoneOwner, owner_id: int) -> list[ContactPhone]:
    return list(db.scalars(
        select(ContactPhone)
        .where(ContactPhone.owner_type == owner_type, ContactPhone.owner_id == owner_id)
        .order_by(ContactPhone.id)
    ).all())


def phone_values(db: Session, owner_type: PhoneOwner, owner_id: int) -> list[str]:
    return [p.phone for p in list_phones(db, owner_type, owner_id)]


def bulk_phone_values(db: Session, owner_type: PhoneOwner,
                      owner_ids: list[int]) -> dict[int, list[str]]:
    if not owner_ids:
        return {}
    out: dict[int, list[str]] = {}
    rows = db.scalars(
        select(ContactPhone)
        .where(ContactPhone.owner_type == owner_type,
               ContactPhone.owner_id.in_(owner_ids))
        .order_by(ContactPhone.id)).all()
    for row in rows:
        out.setdefault(row.owner_id, []).append(row.phone)
    return out


def set_phones(db: Session, owner_type: PhoneOwner, owner_id: int, phones) -> None:
    if phones is None:
        return
    db.execute(
        delete(ContactPhone).where(
            ContactPhone.owner_type == owner_type, ContactPhone.owner_id == owner_id)
    )
    for raw in phones:
        value = (raw or "").strip()
        if value:
            db.add(ContactPhone(owner_type=owner_type, owner_id=owner_id, phone=value))
    db.flush()
