"""Additional contact phone numbers for customers/suppliers (v4).

The primary number stays on the owner's own `phone` column; these are the extra ones. Replacing is
a full swap (delete + insert) — simplest correct semantics for a small child list.
"""
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


def set_phones(db: Session, owner_type: PhoneOwner, owner_id: int, phones) -> None:
    """Replace the owner's extra numbers with `phones` (list of strings). None = leave unchanged."""
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
