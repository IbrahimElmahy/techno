from __future__ import annotations

import enum

from sqlalchemy import BigInteger, Enum, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class PhoneOwner(str, enum.Enum):
    customer = "customer"
    supplier = "supplier"


class ContactPhone(Base):
    __tablename__ = "contact_phone"
    __table_args__ = (Index("ix_contact_phone_owner", "owner_type", "owner_id"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    owner_type: Mapped[PhoneOwner] = mapped_column(Enum(PhoneOwner), nullable=False)
    owner_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    phone: Mapped[str] = mapped_column(String(32), nullable=False)
    label: Mapped[str | None] = mapped_column(String(40), nullable=True)
