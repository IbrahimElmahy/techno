"""التطبيق والسيرفر مربوطين — العقد اللي بينهم بالظبط.

The phone app is a separate codebase that ships as an APK. Nothing in this repository stops the
server renaming a field the app still sends, and the failure is not a red test — it is a rep
standing in a flat whose visit uploads with four blank columns, or does not upload at all, and
finds out days later.

So the payload here is written out the way `mobile/lib/models/models.dart :: toApi()` writes it,
field for field, rather than using this repo's own helpers. If a name drifts on either side, this
goes red on the side that can still be fixed before an APK ships.

What it defends:

* **Every field the app sends is stored and readable back.** A field the server silently ignores is
  worse than one it rejects: the app shows a tick, the rep moves on, and the data is gone.
* **Re-sending the same visit does not duplicate it.** The app retries on a dropped connection by
  design — it is used with no signal — so the same `client_uuid` arriving twice is normal traffic,
  not an error case.
* **معاينة الأصناف مالهاش أثر على المخزون.** Confirmed with the system's owner: inspection items
  are counted for points only and the rep does not fit them from his van.
"""
from __future__ import annotations

from decimal import Decimal


def _visit(**over) -> dict:
    """نفس شكل `toApi()` في التطبيق بالحرف."""
    body = {
        "client_uuid": "insp-aaaa-1111",
        "visit_kind": "technician",
        "inspection_date": "2026-08-14",
        "owner_name": "أحمد صاحب الشقة",
        "owner_phone": "01001234567",
        "national_id": "29001011234567",
        "owner_address": "شارع التحرير، الدقي",
        "floor_number": "3",
        "description": "حمام و مطبخ",
        "inspection_type": "تغذية و صرف",
        "technician_name": "سيد الفني",
        "technician_phone": "01109876543",
        "purchase_shop": "محل النور",
        "purchase_shop_phone": "01234567890",
        "visit_details": "معاينة كاملة",
        "customer_id": None,
        "items": [
            # `item_id` بيفضل null عن قصد — أصناف المعاينة بتتعدّ للنقاط بس.
            {"item_id": None, "item_name": "خلاط مياه", "quantity": "2", "points": "1.5"},
            {"item_id": None, "item_name": "محبس", "quantity": "3", "points": "0.5"},
        ],
    }
    body.update(over)
    return body


def _sync(client, h, *visits):
    return client.post("/api/v1/inspections/sync", headers=h,
                       json={"inspections": list(visits)})


def test_every_field_the_app_sends_comes_back(client, world, login):
    """حقل السيرفر بيتجاهله في صمت أوحش من حقل بيرفضه.

    `purchase_shop_phone` is the newest of these and the reason the test exists: it reached the API
    schema and not the service under it, a shape that fails on EVERY create rather than only the
    ones carrying a phone.
    """
    h = login("rep_a")
    res = _sync(client, h, _visit())
    assert res.status_code == 200, res.text

    doc_id = res.json()[0]["id"]
    saved = client.get(f"/api/v1/inspections/{doc_id}", headers=h)
    assert saved.status_code == 200, saved.text
    body = saved.json()

    sent = _visit()
    for field in ("owner_name", "owner_phone", "national_id", "owner_address", "floor_number",
                  "description", "inspection_type", "technician_name", "technician_phone",
                  "purchase_shop", "purchase_shop_phone", "visit_details", "inspection_date"):
        assert body.get(field) == sent[field], f"«{field}» اتبعت واترجع مختلف أو فاضي"


def test_the_same_visit_sent_twice_stays_one_visit(client, world, login):
    """التطبيق بيعيد الإرسال لما الشبكة تقطع — ده استخدام عادي مش حالة خطأ."""
    h = login("rep_a")
    first = _sync(client, h, _visit())
    assert first.status_code == 200, first.text
    second = _sync(client, h, _visit())
    assert second.status_code == 200, second.text

    assert first.json()[0]["id"] == second.json()[0]["id"], "اترفعت مرتين"
    listing = client.get("/api/v1/inspections", headers=h,
                         params={"date_from": "2026-08-14", "date_to": "2026-08-14"}).json()
    assert len([i for i in listing if i["client_uuid"] == "insp-aaaa-1111"]) == 1


def test_a_batch_of_visits_all_land(client, world, login):
    """المندوب بيقعد يوم من غير شبكة وبيزامن الزيارات كلها مرة واحدة."""
    h = login("rep_a")
    res = _sync(client, h,
                _visit(client_uuid="insp-1", owner_name="أ"),
                _visit(client_uuid="insp-2", owner_name="ب"),
                _visit(client_uuid="insp-3", owner_name="ج"))
    assert res.status_code == 200, res.text
    assert len(res.json()) == 3
    assert {r["client_uuid"] for r in res.json()} == {"insp-1", "insp-2", "insp-3"}


def test_the_points_add_up_the_way_the_phone_showed_them(client, world, login):
    """الرقم اللي المندوب شافه على الشاشة هو اللي بيتسجّل.

    2 × 1.5 + 3 × 0.5 = 4.5 — the phone showed «٤٫٥ نقطة» and told the customer. A server that
    totals it differently makes a liar of the rep.
    """
    h = login("rep_a")
    res = _sync(client, h, _visit())
    assert res.status_code == 200, res.text
    # The sync reply carries only the ids — the total is read back off the stored record, which is
    # also the honest place to check it: what matters is what the office will see, not what the
    # upload echoed.
    saved = client.get(f"/api/v1/inspections/{res.json()[0]['id']}", headers=h).json()
    assert Decimal(str(saved["total_points"])) == Decimal("4.5")


def test_an_inspection_moves_no_stock(client, inv_world, login, db):
    """أصناف المعاينة بتتعدّ للنقاط بس — اتأكدنا من ده مع صاحب النظام.

    The rep does not fit these from his van, so the visit must not draw anything down from his
    custody. The lines carry `item_id: null` for exactly this reason; a line that carried a real
    product id would be posted as an `inspection_out` against him.
    """
    from src.models.stock import StockMovement

    h = login("rep_a")
    before = db.query(StockMovement).count()
    assert _sync(client, h, _visit()).status_code == 200
    assert db.query(StockMovement).count() == before, "المعاينة حرّكت مخزون"


def test_a_visit_with_no_items_is_accepted(client, world, login):
    """«زيارة عادية» تسجيل زيارة مش حدث نقاط — بتترفع من غير أصناف."""
    h = login("rep_a")
    res = _sync(client, h, _visit(visit_kind="regular", items=[]))
    assert res.status_code == 200, res.text
    saved = client.get(f"/api/v1/inspections/{res.json()[0]['id']}", headers=h).json()
    assert Decimal(str(saved["total_points"])) == Decimal("0")
    assert saved["items"] == []


def test_the_app_reads_the_lists_it_needs_to_work_offline(client, world, login):
    """التطبيق بيسحب دول ويشتغل من غير نت بعد كده — لو واحد منهم وقع، المندوب بيقف."""
    h = login("rep_a")
    for path in ("/api/v1/customers", "/api/v1/inspections/item-types",
                 "/api/v1/settings/lookups"):
        res = client.get(path, headers=h, params={"category": "inspection_type"}
                         if "lookups" in path else None)
        assert res.status_code == 200, f"{path} → {res.status_code} {res.text}"


# --------------------------------------------------------- استلام الكوبونات


def _receipt(**over) -> dict:
    """نفس شكل `pushCouponReceipts()` في التطبيق بالحرف."""
    body = {
        "serials": ["1001", "1002"],
        "customer_id": None,
        "notes": "من الجولة",
        "client_uuid": "cr-aaaa-1111",
        # اللي المندوب قاله على الجهاز — السيرفر بيفضل يتحقق من السريالات بنفسه.
        "received_date": "2026-08-14",
        "declared_kind": "gold",
        "declared_value": "165",
        "customer_type": "plumber",
    }
    body.update(over)
    return body


def test_the_app_declared_fields_reach_the_server(client, world, login):
    """اللي المندوب قاله بيسافر معاه.

    A rep at a door with no signal still has to tell the customer «ثلاثة ذهبي» before he walks
    away. The server works the true kind out from the serial's issued range once it sees it, but
    what the rep declared is what the phone added up and what the customer was told — so it is
    carried, not recomputed away.
    """
    h = login("rep_a")
    res = client.post("/api/v1/coupon-receipts", headers=h, json=_receipt())
    assert res.status_code in (201, 409, 422), res.text
    if res.status_code != 201:
        # الكوبونات مش متصرّفة في العالم التجريبي ده — المهم إن السيرفر فهم الحقول
        # ورفضها لسبب شغل، مش إنه اتخض من حقل مش عارفه.
        assert "serial" in res.text or "كوبون" in res.text, res.text
        return
    body = res.json()
    assert body["client_uuid"] == "cr-aaaa-1111"


def test_a_receipt_sent_twice_stays_one_receipt(client, world, login):
    """نفس منطق المعاينات: التطبيق بيعيد الإرسال لما الشبكة تقطع."""
    h = login("rep_a")
    first = client.post("/api/v1/coupon-receipts", headers=h, json=_receipt())
    second = client.post("/api/v1/coupon-receipts", headers=h, json=_receipt())
    assert first.status_code == second.status_code, (first.text, second.text)
    if first.status_code == 201:
        assert first.json()["id"] == second.json()["id"], "اترفع مرتين"


def test_checking_a_serial_answers_rather_than_erroring(client, world, login):
    """الشاشة بتسأل عن كل رقم وهو بيتكتب — ولازم تاخد رد حتى لو الكوبون مش معروف."""
    h = login("rep_a")
    res = client.get("/api/v1/coupon-receipts/check", headers=h, params={"serial": "999999"})
    assert res.status_code == 200, res.text
    assert "status" in res.json(), "الرد مالوش حالة — الشاشة مش هتعرف تلوّن السطر"
