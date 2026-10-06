"""الطرف الواحد بأكتر من كارت — المرحلة ٢ (٢٠٢٦-١٠-٠٦).

في a5 (وعندنا) الشخص اللي بنبيع له ونشتري منه ليه كارت عميل وكارت مورد منفصلين، والفروع
عند بعض كعملاء وموردين، والموظف ممكن يبقى عميل. Odoo بيحلها بـ«جهة اتصال» واحدة بأكتر
من صفة. هنا مابنلمّش الكروت (كل كارت شايل حسابه وتاريخه ومستنداته) — بنربطهم في «طرف»
واحد: صفحة بتجمع أرصدته كلها وصافيها، ومنها سند مقاصة بين اللي عليه واللي له.

الكارت في طرف واحد بس (`uq_party_member`).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class PartyGroup(Base):
    __tablename__ = "party_group"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class PartyGroupMember(Base):
    __tablename__ = "party_group_member"
    __table_args__ = (UniqueConstraint("kind", "ref_id", name="uq_party_member"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("party_group.id"), nullable=False, index=True)
    # customer (ومعاه الموظف والفرع — كروت عملاء بتصنيفهم) / supplier
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    ref_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
