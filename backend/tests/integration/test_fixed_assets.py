"""الأصول الثابتة والإهلاك — B6.

An asset is bought once and consumed over years, so its cost cannot sit in the month it was paid
for: it has to be spread across the months that actually used it. That spreading is the whole
feature, and it has two hard requirements, both tested here.

**It must not post twice.** A depreciation run is a button someone can click again, and a second
click on the same month must change nothing — otherwise the expense doubles and the books are
wrong in a way nobody notices for a year.

**It must stop.** An asset depreciates down to its salvage value and no further; a machine that
kept depreciating past zero would eventually show a negative book value, which is not a thing.
"""
from __future__ import annotations

from decimal import Decimal

import pytest


@pytest.fixture()
def assets_world(client, chart, login, db):
    """The standard chart plus an admin, which is all a fixed asset needs to post."""
    # Order matters: `chart` carries an `admin` user id, and what a test wants is the headers.
    return {**chart, "admin": login("admin")}


def _create(client, h, **body):
    payload = {
        "name": "ماكينة", "acquisition_date": "2026-01-15", "cost": "120000",
        "salvage_value": "0", "useful_life_months": 60, "method": "straight_line",
    }
    payload.update(body)
    return client.post("/api/v1/fixed-assets", headers=h, json=payload)


def _run(client, h, year, month):
    return client.post("/api/v1/fixed-assets/depreciation/run", headers=h,
                       json={"year": year, "month": month})


def _balance(client, h, account_id):
    s = client.get(f"/api/v1/accounts/{account_id}/statement", headers=h).json()
    return Decimal(s["closing_balance"])


def test_an_asset_is_registered_with_its_accounts(client, assets_world):
    admin = assets_world["admin"]
    resp = _create(client, admin, name="سيارة نقل", cost="240000", useful_life_months=48)
    assert resp.status_code == 201, resp.text
    asset = resp.json()
    assert asset["code"].startswith("FA-")
    assert Decimal(asset["cost"]) == Decimal("240000.00")
    assert Decimal(asset["book_value"]) == Decimal("240000.00")  # nothing depreciated yet
    # The three accounts it posts to are resolved up front, not guessed at run time.
    assert asset["asset_account_id"] and asset["accumulated_account_id"]
    assert asset["expense_account_id"]


def test_straight_line_spreads_the_cost_evenly(client, assets_world):
    admin = assets_world["admin"]
    asset = _create(client, admin, cost="120000", salvage_value="0",
                    useful_life_months=60).json()

    run = _run(client, admin, 2026, 2)
    assert run.status_code == 201, run.text
    assert Decimal(run.json()["total"]) == Decimal("2000.00")  # 120000 / 60

    one = client.get(f"/api/v1/fixed-assets/{asset['id']}", headers=admin).json()
    assert Decimal(one["accumulated_depreciation"]) == Decimal("2000.00")
    assert Decimal(one["book_value"]) == Decimal("118000.00")


def test_salvage_value_is_never_depreciated_away(client, assets_world):
    """20000 of cost is expected to survive, so only 100000 may ever become expense."""
    admin = assets_world["admin"]
    _create(client, admin, cost="120000", salvage_value="20000", useful_life_months=50)

    run = _run(client, admin, 2026, 2)
    assert Decimal(run.json()["total"]) == Decimal("2000.00")  # (120000 - 20000) / 50


def test_running_the_same_month_twice_changes_nothing(client, assets_world):
    """The single most important property: a second click must be a no-op, not a double expense."""
    admin = assets_world["admin"]
    asset = _create(client, admin).json()

    first = _run(client, admin, 2026, 2)
    assert Decimal(first.json()["total"]) == Decimal("2000.00")

    second = _run(client, admin, 2026, 2)
    assert second.status_code == 201, second.text
    assert Decimal(second.json()["total"]) == Decimal("0.00")
    assert second.json()["skipped"] == 1

    one = client.get(f"/api/v1/fixed-assets/{asset['id']}", headers=admin).json()
    assert Decimal(one["accumulated_depreciation"]) == Decimal("2000.00")


def test_depreciation_posts_a_balanced_double_entry(client, assets_world):
    admin = assets_world["admin"]
    asset = _create(client, admin).json()
    _run(client, admin, 2026, 2)

    expense = _balance(client, admin, asset["expense_account_id"])
    accumulated = _balance(client, admin, asset["accumulated_account_id"])
    assert expense == Decimal("2000.00")
    # The contra-asset carries the same figure on the other side of the entry.
    assert accumulated == Decimal("2000.00")


def test_depreciation_stops_at_the_end_of_its_life(client, assets_world):
    """A two-month life depreciates twice and then never again, whatever anyone clicks."""
    admin = assets_world["admin"]
    asset = _create(client, admin, acquisition_date="2026-01-10", cost="1000",
                    salvage_value="0", useful_life_months=2).json()

    assert Decimal(_run(client, admin, 2026, 1).json()["total"]) == Decimal("500.00")
    assert Decimal(_run(client, admin, 2026, 2).json()["total"]) == Decimal("500.00")
    assert Decimal(_run(client, admin, 2026, 3).json()["total"]) == Decimal("0.00")

    one = client.get(f"/api/v1/fixed-assets/{asset['id']}", headers=admin).json()
    assert Decimal(one["book_value"]) == Decimal("0.00")
    assert Decimal(one["accumulated_depreciation"]) == Decimal("1000.00")


def test_an_asset_is_not_depreciated_before_it_was_bought(client, assets_world):
    admin = assets_world["admin"]
    _create(client, admin, acquisition_date="2026-06-01", cost="60000",
            useful_life_months=60)

    early = _run(client, admin, 2026, 5)
    assert Decimal(early.json()["total"]) == Decimal("0.00")
    assert Decimal(_run(client, admin, 2026, 6).json()["total"]) == Decimal("1000.00")


def test_declining_balance_front_loads_the_expense(client, assets_world):
    """The point of the method: the first month costs more than the second."""
    admin = assets_world["admin"]
    _create(client, admin, cost="120000", salvage_value="0", useful_life_months=60,
            method="declining_balance", acquisition_date="2026-01-05")

    first = Decimal(_run(client, admin, 2026, 1).json()["total"])
    second = Decimal(_run(client, admin, 2026, 2).json()["total"])
    assert first > second > Decimal("0.00")


def test_disposal_clears_the_asset_and_books_the_result(client, assets_world):
    """Selling for more than the book value is a gain; the asset stops depreciating either way."""
    admin = assets_world["admin"]
    asset = _create(client, admin, cost="1000", salvage_value="0",
                    useful_life_months=2, acquisition_date="2026-01-10").json()
    _run(client, admin, 2026, 1)  # book value now 500

    resp = client.post(f"/api/v1/fixed-assets/{asset['id']}/dispose", headers=admin,
                       json={"disposal_date": "2026-02-01", "proceeds": "700"})
    assert resp.status_code == 200, resp.text
    disposed = resp.json()
    assert disposed["status"] == "disposed"
    assert Decimal(disposed["gain_loss"]) == Decimal("200.00")  # 700 - 500

    # A disposed asset is out of the register — later runs must not touch it.
    assert Decimal(_run(client, admin, 2026, 2).json()["total"]) == Decimal("0.00")


def test_a_run_can_be_reversed_and_then_re_run(client, assets_world):
    """A month posted by mistake is reversed, not edited — and then the month is free again."""
    admin = assets_world["admin"]
    asset = _create(client, admin).json()
    _run(client, admin, 2026, 2)

    undo = client.post("/api/v1/fixed-assets/depreciation/reverse", headers=admin,
                       json={"year": 2026, "month": 2})
    assert undo.status_code == 201, undo.text

    one = client.get(f"/api/v1/fixed-assets/{asset['id']}", headers=admin).json()
    assert Decimal(one["accumulated_depreciation"]) == Decimal("0.00")
    assert _balance(client, admin, asset["expense_account_id"]) == Decimal("0.00")

    again = _run(client, admin, 2026, 2)
    assert Decimal(again.json()["total"]) == Decimal("2000.00")


def test_the_register_lists_assets_with_their_book_value(client, assets_world):
    admin = assets_world["admin"]
    _create(client, admin, name="مكتب", cost="5000", useful_life_months=50,
            acquisition_date="2026-01-01")
    _run(client, admin, 2026, 1)

    rows = client.get("/api/v1/fixed-assets", headers=admin).json()
    row = next(r for r in rows if r["name"] == "مكتب")
    assert Decimal(row["accumulated_depreciation"]) == Decimal("100.00")
    assert Decimal(row["book_value"]) == Decimal("4900.00")
