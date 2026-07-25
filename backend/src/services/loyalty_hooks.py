"""Loyalty subscribers to the 002 sale events (T016/T037).

Keeps the 002→003 dependency direction: 002 only `emit`s named events via `core.hooks`; here 003
subscribes. Earning/reversal run in the sale's transaction (before commit), so points stay
consistent with the sale.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from src.core import hooks
from src.services import point_service


def on_sale_created(db: Session, invoice) -> None:
    point_service.earn_for_invoice(db, invoice)


def on_sale_returned(db: Session, sales_return, invoice) -> None:
    point_service.reverse_for_return(db, sales_return, invoice)
    point_service.reconcile_return(db, invoice.customer_id, sales_return.id)


def on_standalone_return_created(db: Session, sales_return) -> None:
    """028: a return with no originating invoice still removes the points the goods once earned."""
    point_service.reverse_for_standalone_return(db, sales_return)
    point_service.reconcile_return(db, sales_return.customer_id, sales_return.id)


def register() -> None:
    """Idempotent subscription; called once at app startup."""
    hooks.subscribe("sale_created", on_sale_created)
    hooks.subscribe("sale_returned", on_sale_returned)
    hooks.subscribe("standalone_return_created", on_standalone_return_created)


register()
