"""الجرد بسطوره، والمردود بسطوره — 031-a5-restructure.

Two columns that were stored and never read. Both have the same shape and the same cost: a screen
shows a figure it cannot break down, so the only way to «رجعنا إيه بالظبط» or «الأدوات الصحية
عندنا منها كام» was to open something else, or paper.

* `purchase_return_line` has recorded what went back since returns were built. There was no
  endpoint that returned it, so the register could say a return was worth 4,300 and never which
  items made it up.
* `item.category` has been on every item for as long as items have had one, and `stock_as_of` —
  the derivation every stocktake screen reads — dropped it. A count sheet is read one category at
  a time; without the column the only way there was a name search per item.
"""
from __future__ import annotations


def _item(client, h, *, name, category=None):
    body = {"name": name, "kind": "raw_material", "unit_of_measure": "piece",
            "purchase_price": "100"}
    if category is not None:
        body["category"] = category
    res = client.post("/api/v1/items", headers=h, json=body)
    assert res.status_code in (200, 201), res.text
    return res.json()


def _purchase(client, h, *, supplier_id, warehouse_id, lines):
    res = client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": supplier_id,
        "location": {"location_kind": "warehouse", "location_id": warehouse_id},
        "lines": lines, "cash_amount": "0",
        "credit_amount": str(sum(float(ln["quantity"]) * float(ln["unit_price"]) for ln in lines)),
    })
    assert res.status_code == 201, res.text
    return res.json()


class TestPurchaseReturnLines:
    def test_a_return_can_be_asked_what_was_in_it(self, client, inv_world, login):
        h = login("admin")
        bolt = _item(client, h, name="مسمار")
        nut = _item(client, h, name="صامولة")
        sup = client.post("/api/v1/suppliers", headers=h, json={"name": "Acme"}).json()
        purchase = _purchase(client, h, supplier_id=sup["id"],
                             warehouse_id=inv_world["central_wh"], lines=[
                                 {"item_id": bolt["id"], "quantity": "10", "unit_price": "100"},
                                 {"item_id": nut["id"], "quantity": "20", "unit_price": "50"}])

        made = client.post(f"/api/v1/purchases/{purchase['id']}/returns", headers=h, json={
            "lines": [{"item_id": bolt["id"], "quantity": "3"}]})
        assert made.status_code == 201, made.text

        res = client.get(f"/api/v1/purchases/returns/{made.json()['id']}", headers=h)
        assert res.status_code == 200, res.text
        body = res.json()

        # The lines are the whole point: the value alone was already on the register row.
        assert len(body["lines"]) == 1
        line = body["lines"][0]
        assert line["item_id"] == bolt["id"]
        assert float(line["quantity"]) == 3
        # Named, not numbered. «صنف #47 رجع منه ٣» is not something a storekeeper can check.
        assert line["item_name"] == "مسمار"

    def test_it_still_carries_the_purchase_it_came_off(self, client, inv_world, login):
        """The detail must not lose what the row already had, or the sheet is a step backwards."""
        h = login("admin")
        item = _item(client, h, name="ماسورة")
        sup = client.post("/api/v1/suppliers", headers=h, json={"name": "Pipes Ltd"}).json()
        purchase = _purchase(client, h, supplier_id=sup["id"],
                             warehouse_id=inv_world["central_wh"],
                             lines=[{"item_id": item["id"], "quantity": "5", "unit_price": "100"}])
        made = client.post(f"/api/v1/purchases/{purchase['id']}/returns", headers=h, json={
            "lines": [{"item_id": item["id"], "quantity": "2"}]}).json()

        body = client.get(f"/api/v1/purchases/returns/{made['id']}", headers=h).json()
        assert body["purchase_invoice_id"] == purchase["id"]
        assert body["purchase_document_number"] == purchase["document_number"]
        assert body["supplier_name"] == "Pipes Ltd"

    def test_a_return_that_does_not_exist_is_a_404_not_a_500(self, client, inv_world, login):
        assert client.get("/api/v1/purchases/returns/999999", headers=login("admin")).status_code == 404

    def test_the_detail_route_is_not_swallowed_by_the_purchase_id_route(self, client, inv_world, login):
        """`/purchases/returns/{id}` sits under `/purchases/{purchase_id}`, and FastAPI matches in
        declaration order. Declared the wrong way round it would try to parse "returns" as an int
        and fail with a validation error rather than returning a return."""
        h = login("admin")
        item = _item(client, h, name="لية")
        sup = client.post("/api/v1/suppliers", headers=h, json={"name": "S"}).json()
        purchase = _purchase(client, h, supplier_id=sup["id"],
                             warehouse_id=inv_world["central_wh"],
                             lines=[{"item_id": item["id"], "quantity": "4", "unit_price": "100"}])
        made = client.post(f"/api/v1/purchases/{purchase['id']}/returns", headers=h, json={
            "lines": [{"item_id": item["id"], "quantity": "1"}]}).json()

        res = client.get(f"/api/v1/purchases/returns/{made['id']}", headers=h)
        assert res.status_code == 200, res.text
        # And the purchase route still works beside it, which is the half that a fix here breaks.
        assert client.get(f"/api/v1/purchases/{purchase['id']}", headers=h).status_code == 200


class TestStockSheetCategory:
    def test_the_count_sheet_carries_the_category(self, client, inv_world, login):
        h = login("admin")
        item = _item(client, h, name="حنفية", category="أدوات صحية")
        sup = client.post("/api/v1/suppliers", headers=h, json={"name": "Taps"}).json()
        _purchase(client, h, supplier_id=sup["id"], warehouse_id=inv_world["central_wh"],
                  lines=[{"item_id": item["id"], "quantity": "6", "unit_price": "100"}])

        res = client.get("/api/v1/reports/stock-as-of", headers=h)
        assert res.status_code == 200, res.text
        row = next((r for r in res.json()["rows"] if r["item_id"] == item["id"]), None)
        assert row is not None, "الصنف المشترى لازم يبان في الجرد"
        assert row["category"] == "أدوات صحية"

    def test_an_item_with_no_category_says_so_rather_than_going_missing(
            self, client, inv_world, login):
        """A null is a real answer — «الأصناف اللي محدش صنّفها» is a list somebody needs — and the
        column filter offers `(فاضي)` as a value, which only works if the key is present."""
        h = login("admin")
        item = _item(client, h, name="صنف بلا فئة")
        sup = client.post("/api/v1/suppliers", headers=h, json={"name": "Anon"}).json()
        _purchase(client, h, supplier_id=sup["id"], warehouse_id=inv_world["central_wh"],
                  lines=[{"item_id": item["id"], "quantity": "2", "unit_price": "100"}])

        rows = client.get("/api/v1/reports/stock-as-of", headers=h).json()["rows"]
        row = next((r for r in rows if r["item_id"] == item["id"]), None)
        assert row is not None
        assert "category" in row, "المفتاح لازم يبقى موجود حتى لو فاضي"
        assert row["category"] is None

    def test_the_sheet_is_a_row_per_item_and_store(self, client, inv_world, login):
        """The shape both جرد screens are built on: جرد المخازن reads these rows as they are, and
        جرد عام sums them per item. If one item in two stores came back as one row, the detailed
        sheet would be unable to say where anything is."""
        h = login("admin")
        item = _item(client, h, name="صنف في مخزنين", category="خامات")
        sup = client.post("/api/v1/suppliers", headers=h, json={"name": "Two"}).json()
        _purchase(client, h, supplier_id=sup["id"], warehouse_id=inv_world["central_wh"],
                  lines=[{"item_id": item["id"], "quantity": "7", "unit_price": "100"}])
        _purchase(client, h, supplier_id=sup["id"], warehouse_id=inv_world["branch_wh"],
                  lines=[{"item_id": item["id"], "quantity": "3", "unit_price": "100"}])

        rows = [r for r in client.get("/api/v1/reports/stock-as-of", headers=h).json()["rows"]
                if r["item_id"] == item["id"]]
        assert len(rows) == 2, "صنف في مخزنين = سطرين"
        assert {r["location_id"] for r in rows} == {inv_world["central_wh"], inv_world["branch_wh"]}
        # And what the «عام» view will add up to.
        assert sum(float(r["quantity"]) for r in rows) == 10
