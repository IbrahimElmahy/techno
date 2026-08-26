"""Stock transfers with source-branch approval (T040). FR-022–024."""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import QTY
from src.models.stock import LocationKind


class TransferRoute(str, enum.Enum):
    central_to_branch = "central_to_branch"
    central_to_rep = "central_to_rep"
    rep_to_rep = "rep_to_rep"
    # المندوب بيرجّع بضاعة للمخزن. المسار ده كان ناقص، والشاشة كانت بتقول «التحويل من عهدة
    # مندوب إلى مخزن غير متاح حالياً — استخدم تسليم العهدة»، وتسليم العهدة بيسلّم فلوس مش
    # بضاعة. يعني البضاعة اللي في عربية المندوب ماكانش ليها طريق ترجع بيه.
    rep_to_central = "rep_to_central"


class TransferStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    reversed = "reversed"


class StockTransfer(Base):
    __tablename__ = "stock_transfer"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    route: Mapped[TransferRoute] = mapped_column(Enum(TransferRoute), nullable=False)
    source_location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    source_location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    dest_location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    dest_location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[TransferStatus] = mapped_column(
        Enum(TransferStatus), default=TransferStatus.pending, nullable=False
    )
    initiated_by: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # (031) ليه اترفض. On the document because the person who asked for the transfer reads this
    # screen, not the audit log.
    reject_reason: Mapped[str | None] = mapped_column(String(240), nullable=True)
    lines: Mapped[list["StockTransferLine"]] = relationship(
        back_populates="transfer", cascade="all, delete-orphan")
    out_movement_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_movement.id"), nullable=True
    )
    in_movement_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_movement.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class StockTransferLine(Base):
    """سطر في إذن التحويل — صنف وكمية.

    (031) A transfer used to BE one item: `item_id` and `quantity` sat on the document, so moving
    five items meant five documents created together with nothing tying them. «امسح صنف من الإذن»
    then had only one meaning — delete the document — which is exactly what must not happen.

    So the item moves onto lines and the document becomes what it always was in people's heads: one
    request, from here to there, carrying several things.

    The document's own `item_id`/`quantity` stay for every transfer written before this. Approval
    reads the lines when there are any and falls back to the document otherwise, so nothing already
    posted has to be migrated to keep working.
    """

    __tablename__ = "stock_transfer_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    transfer_id: Mapped[int] = mapped_column(
        ForeignKey("stock_transfer.id"), nullable=False, index=True)
    transfer: Mapped["StockTransfer"] = relationship(back_populates="lines")
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    # Set when the line is approved, so a partially-approved document can say which lines moved.
    out_movement_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    in_movement_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
