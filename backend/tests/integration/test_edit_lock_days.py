"""قفل تعديل المستندات (أيام) — نافذة متحرّكة للتعديل والعكس.

Read off their اعدادات القاعدة: «بعد N أيام من تاريخ المستند، لا يمكن لغير المسؤول تعديل أو حذف
المستند». It complements our hard period lock rather than replacing it — the lock is a deliberate act
on a date the accountant chooses, and it only protects a month somebody remembered to close. This one
closes the ordinary user's window by itself.

Off by default, so the first test here is that nothing changed for anyone who does not set it.
"""
from datetime import date, timedelta


def _set_days(client, h, days):
    return client.put("/api/v1/settings/sales", headers=h, json={
        "fixed_discount_pct": "0", "vat_rate_pct": "0", "edit_lock_days": days})


def _journal(client, h, chart, *, when):
    return client.post("/api/v1/journal-entries", headers=h, json={
        "description": "قيد للاختبار", "date": when.isoformat(), "branch_id": chart["branch_a"],
        "lines": [
            {"account_id": chart["rent"], "direction": "debit", "amount": "10"},
            {"account_id": chart["treasury"], "direction": "credit", "amount": "10"},
        ]})


def test_off_by_default_an_old_document_still_reverses(client, chart, login):
    """Nobody who has not set this notices it exists."""
    admin = login("admin")
    old = date.today() - timedelta(days=400)
    entry = _journal(client, admin, chart, when=old)
    assert entry.status_code == 201, entry.text

    rev = client.post(f"/api/v1/journal-entries/{entry.json()['id']}/reverse", headers=admin)
    assert rev.status_code == 201, rev.text


def test_past_the_window_a_non_admin_is_refused(client, chart, login):
    admin = login("admin")
    accountant = login("acct")
    old = date.today() - timedelta(days=45)
    entry = _journal(client, accountant, chart, when=old)
    assert entry.status_code == 201, entry.text

    assert _set_days(client, admin, 30).status_code == 200

    refused = client.post(f"/api/v1/journal-entries/{entry.json()['id']}/reverse",
                          headers=accountant)
    assert refused.status_code == 409, refused.text
    assert "مسؤول" in refused.text


def test_inside_the_window_a_non_admin_may_still_reverse(client, chart, login):
    """The window is there to stop quiet edits to old months, not to stop today's work."""
    admin = login("admin")
    accountant = login("acct")
    recent = date.today() - timedelta(days=3)
    entry = _journal(client, accountant, chart, when=recent)
    assert entry.status_code == 201, entry.text

    assert _set_days(client, admin, 30).status_code == 200
    rev = client.post(f"/api/v1/journal-entries/{entry.json()['id']}/reverse", headers=accountant)
    assert rev.status_code == 201, rev.text


def test_the_admin_can_always_reverse(client, chart, login):
    """Somebody has to be able to fix a genuine mistake in a closed month."""
    admin = login("admin")
    old = date.today() - timedelta(days=200)
    entry = _journal(client, admin, chart, when=old)
    assert entry.status_code == 201, entry.text

    assert _set_days(client, admin, 7).status_code == 200
    rev = client.post(f"/api/v1/journal-entries/{entry.json()['id']}/reverse", headers=admin)
    assert rev.status_code == 201, rev.text


def test_the_setting_round_trips_and_zero_means_off(client, chart, login):
    admin = login("admin")
    assert _set_days(client, admin, 15).json()["edit_lock_days"] == 15
    read = client.get("/api/v1/settings/sales", headers=admin).json()
    assert read["edit_lock_days"] == 15
    # 0 and NULL both mean off; storing 0 as NULL keeps «off» to one representation, so no reader
    # has to remember that both exist.
    assert _set_days(client, admin, 0).json()["edit_lock_days"] is None


def test_a_negative_window_is_refused(client, chart, login):
    admin = login("admin")
    assert _set_days(client, admin, -5).status_code == 422
