"""فحص سلامة البيانات + الأرقام التسلسلية والدفعات لازم تتنقل مع البضاعة.

The integrity check was written as the honest answer to their أدوات خاصة (مراجعه المخازن، مراجعه
السرايل…). Theirs *repairs* recomputed balances; ours has nothing to recompute, because on-hand is
always summed from the movements and never cached. What ours checks is the two things that really are
stored beside the movements and could therefore disagree with them: expiry lots and serial numbers.

It earned its place immediately. Run against the development database it reported three in-stock
serials at a warehouse whose derived on-hand was zero — a **warehouse transfer moved the quantity and
left the serials behind**. The consequences were real: the destination could not sell units it
physically held (their serials were not there), and the source listed serials for units that had
left. The same hole applied to expiry lots, so a transfer of perishable goods left its lots at the
source, where the expiry report would keep listing goods that were no longer there and FEFO at the
destination would refuse a sale for stock in front of the salesman.

These tests are the fix pinned down, and the check kept as a standing guard.
"""
from datetime import date, timedelta
from decimal import Decimal


def _approve_transfer(client, h, *, item_id, qty, src, dest):
    initiated = client.post("/api/v1/transfers", headers=h, json={
        "item_id": item_id, "quantity": str(qty), "route": "central_to_branch",
        "source": {"location_kind": "warehouse", "location_id": src},
        "dest": {"location_kind": "warehouse", "location_id": dest},
    })
    assert initiated.status_code == 201, initiated.text
    approved = client.post(f"/api/v1/transfers/{initiated.json()['id']}/approve", headers=h)
    assert approved.status_code == 200, approved.text
    return approved.json()


def test_a_transfer_carries_the_serials_with_the_goods(client, inv_world, login):
    """The destination must be able to sell what it holds, and the source must not list what left."""
    admin = login("admin")
    src, dest = inv_world["central_wh"], inv_world["branch_wh"]
    item = client.post("/api/v1/items", headers=admin, json={
        "name": "صنف مسلسل للنقل", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "500", "is_serialized": True}).json()
    received = client.post(f"/api/v1/items/{item['id']}/serials/receive", headers=admin, json={
        "location_kind": "warehouse", "location_id": src,
        "serials": ["SN-A1", "SN-A2", "SN-A3"]})
    assert received.status_code == 201, received.text

    _approve_transfer(client, admin, item_id=item["id"], qty=2, src=src, dest=dest)

    serials = client.get(f"/api/v1/items/{item['id']}/serials", headers=admin).json()
    at_dest = [s for s in serials
               if s.get("location_id") == dest and s["status"] == "in_stock"]
    at_src = [s for s in serials
              if s.get("location_id") == src and s["status"] == "in_stock"]
    assert len(at_dest) == 2, f"المفروض ٢ أرقام تسلسلية انتقلت: {serials}"
    assert len(at_src) == 1, f"المفروض يفضل واحد في المصدر: {serials}"


def test_a_transfer_carries_the_expiry_lots_with_the_goods(client, inv_world, login):
    """Otherwise the source's expiry report lists goods it lost and FEFO at the destination is empty."""
    admin = login("admin")
    src, dest = inv_world["central_wh"], inv_world["branch_wh"]
    expiry = (date.today() + timedelta(days=60)).isoformat()
    item = client.post("/api/v1/items", headers=admin, json={
        "name": "صنف صلاحية للنقل", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "50", "is_perishable": True}).json()
    got = client.post("/api/v1/stock/batches", headers=admin, json={
        "item_id": item["id"], "location_kind": "warehouse", "location_id": src,
        "expiry_date": expiry, "quantity": "10"})
    assert got.status_code == 201, got.text

    _approve_transfer(client, admin, item_id=item["id"], qty=4, src=src, dest=dest)

    lots = client.get("/api/v1/stock/batches/expiring", headers=admin, params={
        "before": (date.today() + timedelta(days=365)).isoformat(),
        "item_id": item["id"]}).json()
    moved = sum(Decimal(str(l["quantity"])) for l in lots
                if int(l["location_id"]) == dest)
    left = sum(Decimal(str(l["quantity"])) for l in lots
               if int(l["location_id"]) == src)
    assert moved == Decimal("4.000"), f"المفروض ٤ انتقلت للمخزن التاني: {lots}"
    assert left == Decimal("6.000"), f"المفروض يفضل ٦ في المصدر: {lots}"
    # The lot keeps its own expiry date — a transfer moves goods, it does not re-date them.
    assert all(str(l["expiry_date"]) == expiry for l in lots)


def test_the_integrity_check_is_clean_after_ordinary_work(client, inv_world, login):
    """A serialized transfer, a perishable transfer and a sale, then every invariant still holds."""
    admin = login("admin")
    src, dest = inv_world["central_wh"], inv_world["branch_wh"]
    item = client.post("/api/v1/items", headers=admin, json={
        "name": "صنف الفحص", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "300", "is_serialized": True}).json()
    client.post(f"/api/v1/items/{item['id']}/serials/receive", headers=admin, json={
        "location_kind": "warehouse", "location_id": src,
        "serials": ["SN-B1", "SN-B2"]})
    _approve_transfer(client, admin, item_id=item["id"], qty=1, src=src, dest=dest)

    report = client.get("/api/v1/admin/integrity", headers=admin)
    assert report.status_code == 200, report.text
    body = report.json()
    assert body["clean"], f"فيه تعارض في البيانات: {body['findings']}"
    # The counts prove the checks actually looked at something rather than passing vacuously.
    assert body["checked"]["stock_balances"] > 0


def test_the_integrity_check_reports_drift_rather_than_repairing_it(client, inv_world, login, db):
    """A failing check is a defect to trace, not a number to patch — so it reports and touches nothing.

    Drift is forced here the only way it can happen: writing one side directly, behind the services
    that normally move both.
    """
    from src.models.catalog import ItemSerial, SerialStatus

    admin = login("admin")
    src = inv_world["central_wh"]
    item = client.post("/api/v1/items", headers=admin, json={
        "name": "صنف مدسوس", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "10", "is_serialized": True}).json()
    db.add(ItemSerial(item_id=item["id"], serial="SN-ORPHAN", status=SerialStatus.in_stock,
                      location_kind="warehouse", location_id=src))
    db.commit()

    body = client.get("/api/v1/admin/integrity", headers=admin).json()
    assert not body["clean"]
    assert any(f["check"] == "serial_count_equals_on_hand" for f in body["findings"])

    # Nothing was repaired: the orphan is still there, waiting to be explained.
    still_there = db.query(ItemSerial).filter(ItemSerial.serial == "SN-ORPHAN").one_or_none()
    assert still_there is not None
    assert still_there.status == SerialStatus.in_stock
