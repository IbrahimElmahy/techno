"""T005: barcode rules — global-unique, per-unit validation, lookup factor."""
from decimal import Decimal

import pytest

from src.services import barcode_service
from src.services.barcode_service import BarcodeError, BarcodeInput
from tests.conftest import make_priced_product, make_unit


def test_lookup_resolves_unit_and_factor(db, world):
    item = make_priced_product(db, sale_price="100")
    make_unit(db, item, "carton", 12)
    barcode_service.set_barcodes(db, item=item, barcodes=[
        BarcodeInput("BC-BASE"), BarcodeInput("BC-CARTON", "carton")])
    db.commit()

    base = barcode_service.lookup(db, "BC-BASE")
    assert base.item_id == item.id and base.unit is None and base.factor == Decimal("1")
    assert base.base_sale_price == Decimal("100.00")

    carton = barcode_service.lookup(db, "BC-CARTON")
    assert carton.unit == "carton" and carton.factor == Decimal("12.000")


def test_unknown_lookup_returns_none(db, world):
    assert barcode_service.lookup(db, "NOPE") is None


def test_global_unique_across_items(db, world):
    a = make_priced_product(db, name="A")
    b = make_priced_product(db, name="B")
    barcode_service.set_barcodes(db, item=a, barcodes=[BarcodeInput("DUP")])
    db.commit()
    with pytest.raises(BarcodeError):
        barcode_service.set_barcodes(db, item=b, barcodes=[BarcodeInput("DUP")])


def test_unknown_unit_rejected(db, world):
    item = make_priced_product(db)
    with pytest.raises(BarcodeError):
        barcode_service.set_barcodes(db, item=item, barcodes=[BarcodeInput("X", "pallet")])


def test_replace_semantics(db, world):
    item = make_priced_product(db)
    barcode_service.set_barcodes(db, item=item, barcodes=[BarcodeInput("OLD")])
    barcode_service.set_barcodes(db, item=item, barcodes=[BarcodeInput("NEW")])
    db.commit()
    assert barcode_service.lookup(db, "OLD") is None
    assert barcode_service.lookup(db, "NEW") is not None
