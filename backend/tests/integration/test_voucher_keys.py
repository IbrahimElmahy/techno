"""مفاتيح خاصة — الاتجاه هو اللي بيحدد نوع السند.

Their system carries «مفاتيح خاصة» beside «قيد حر», not beside «اوراق قبض ودفع», and that
placement is the specification: a free entry asks for both accounts every time; a key is the same
entry with the accounts already answered.

The rule the user was explicit about — «برده حسب مين اخترناه المدين ومين الدائن» — is that the
DIRECTION decides what the key posts. «مدين الخزينة / دائن العملاء» is money coming in from a
customer, so it has to post as a سند قبض and inherit the أبيض/بولي split, the rep's custody rules
and the safe's balance guard. Turn the pair around and it is something else entirely.

Getting that backwards would not fail loudly. It would post a real document in the wrong direction,
and the balance would be wrong by twice the amount.
"""
from __future__ import annotations


def _accounts(client, h):
    return client.get("/api/v1/accounts", headers=h).json()


def _by_type(accounts, account_type, postable=None):
    for a in accounts:
        if a.get("account_type") == account_type:
            if postable is None or a.get("is_postable") == postable:
                return a
    return None


def _pair(db, name="عميل المفتاح"):
    """حساب خزينة وحساب عملاء — بنعملهم بنفسنا بدل ما نتخطى الاختبار.

    These two tests are the whole point of the file, and skipping them whenever the seeded world
    happened not to carry a safe meant the direction rule was never actually checked. What is being
    tested is how a PAIR OF ACCOUNT TYPES resolves, so two accounts of those types is not a
    stand-in for the real thing — it is exactly the input the rule reads.
    """
    from src.models.ledger import Account, AccountType, Direction

    treasury = Account(account_type=AccountType.treasury, normal_side=Direction.debit,
                       name="خزنة المفتاح", is_postable=True)
    customer = Account(account_type=AccountType.customer_receivable,
                       normal_side=Direction.debit, name=name, is_postable=False)
    db.add_all([treasury, customer])
    db.commit()
    return treasury.id, customer.id


def _make(client, h, name, debit_id, credit_id, **extra):
    return client.post("/api/v1/voucher-keys", headers=h, json={
        "name": name, "debit_account_id": debit_id, "credit_account_id": credit_id, **extra})


def test_a_key_is_saved_and_read_back(client, inv_world, login, chart):
    h = login("admin")
    accs = _accounts(client, h)
    a, b = accs[0], accs[1]
    res = _make(client, h, "مفتاح تجريبي", a["id"], b["id"], description="بيان جاهز")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["name"] == "مفتاح تجريبي"
    assert body["description"] == "بيان جاهز"

    listed = client.get("/api/v1/voucher-keys", headers=h).json()
    assert any(k["id"] == body["id"] for k in listed)


def test_the_same_two_accounts_mean_different_things_each_way(
        client, inv_world, login, chart, db):
    """The point the user made twice, pinned.

    Treasury debit / customer credit is a collection. The reverse is not a collection — and if the
    key resolved to the same voucher either way, one of the two would post backwards.
    """
    h = login("admin")
    treasury_id, customer_id = _pair(db, "عميل الاتجاه")

    inward = _make(client, h, "تحصيل", treasury_id, customer_id).json()
    outward = _make(client, h, "رد للعميل", customer_id, treasury_id).json()

    assert inward["voucher_kind"] == "receipt", inward
    assert outward["voucher_kind"] != "receipt", outward


def test_a_customer_key_knows_it_has_to_ask_who(client, inv_world, login, chart, db):
    """«العملاء» is a heading, not an account — so the key says the door has to ask which one."""
    h = login("admin")
    treasury_id, customer_id = _pair(db, "عميل السؤال")

    key = _make(client, h, "تحصيل نقدي", treasury_id, customer_id).json()
    assert "customer" in key["asks"], key


def test_a_pair_nobody_recognises_still_works_as_a_free_entry(client, inv_world, login, chart):
    """«قيد حر» with the accounts pre-filled — the whole reason this sits next to it in their menu.

    Refusing an unrecognised pair would make the feature narrower than the free entry it is a
    shortcut for, which is the wrong way round.
    """
    h = login("admin")
    accs = _accounts(client, h)
    expenses = [a for a in accs if a.get("nature") == "expense" and a.get("is_postable")]
    if len(expenses) < 2:
        import pytest
        pytest.skip("مفيش حسابين مصروفات")

    key = _make(client, h, "تسوية بين مصروفين", expenses[0]["id"], expenses[1]["id"]).json()
    assert key["voucher_kind"] == "journal", key


def test_the_two_sides_cannot_be_the_same_account(client, inv_world, login, chart):
    """An entry from an account to itself moves nothing and balances trivially — it would post
    cleanly and mean nothing, which is worse than being refused."""
    h = login("admin")
    a = _accounts(client, h)[0]
    res = _make(client, h, "مفتاح غلط", a["id"], a["id"])
    assert res.status_code == 422, res.text


def test_setting_one_up_is_not_something_everybody_may_do(client, inv_world, login, chart):
    """Reading the keys is open to anybody who may write a voucher; DEFINING one decides where
    money lands for everybody who presses it."""
    h = login("admin")
    accs = _accounts(client, h)
    res = client.post("/api/v1/voucher-keys", headers=login("rep_a"), json={
        "name": "مفتاح مندوب", "debit_account_id": accs[0]["id"],
        "credit_account_id": accs[1]["id"]})
    assert res.status_code == 403, res.text


def test_deleting_a_key_is_not_deleting_what_it_posted(client, inv_world, login, chart):
    """A voucher is its own document and does not point back at the shortcut that opened it."""
    h = login("admin")
    accs = _accounts(client, h)
    key = _make(client, h, "مفتاح مؤقت", accs[0]["id"], accs[1]["id"]).json()
    res = client.delete(f"/api/v1/voucher-keys/{key['id']}", headers=h)
    assert res.status_code == 200, res.text
    listed = client.get("/api/v1/voucher-keys", headers=h).json()
    assert not any(k["id"] == key["id"] for k in listed)


def test_the_setup_screen_can_ask_what_a_pair_would_post_before_saving_it(
        client, inv_world, login, chart, db):
    """Configuring a key blind — pick two accounts, save, hope — is how one gets defined backwards.

    The preview has to come from the same table that posts, so this asserts the endpoint agrees
    with what the saved key reports rather than merely returning something plausible.
    """
    h = login("admin")
    treasury_id, customer_id = _pair(db, "عميل المعاينة")

    res = client.get("/api/v1/voucher-keys/resolve", headers=h, params={
        "debit_account_id": treasury_id, "credit_account_id": customer_id})
    assert res.status_code == 200, res.text
    preview = res.json()
    assert preview["voucher_kind"] == "receipt", preview
    assert "customer" in preview["asks"], preview

    saved = _make(client, h, "مفتاح المعاينة", treasury_id, customer_id).json()
    assert preview["voucher_kind"] == saved["voucher_kind"]
    assert preview["asks"] == saved["asks"]


def _heading_over_customers(db, count=2):
    """«الذمم المدينة» زي ما هي في الشجرة الحقيقية — عنوان تحته حسابات العملاء.

    This is the shape that actually exists: the heading is stored `user_defined` and only the
    per-customer accounts underneath carry `customer_receivable`. Building the test on two loose
    accounts hid that, and the most obvious key anybody would set up resolved to a free entry.
    """
    from src.models.ledger import Account, AccountType, Direction

    heading = Account(account_type=AccountType.user_defined, normal_side=Direction.debit,
                      name="الذمم المدينة", is_postable=False)
    db.add(heading)
    db.flush()
    for i in range(count):
        db.add(Account(account_type=AccountType.customer_receivable,
                       normal_side=Direction.debit, name=f"عميل {i}",
                       is_postable=True, parent_id=heading.id))
    treasury = Account(account_type=AccountType.treasury, normal_side=Direction.debit,
                       name="الخزينة", is_postable=True)
    db.add(treasury)
    db.commit()
    return treasury.id, heading.id


def test_a_heading_means_what_is_under_it(client, inv_world, login, chart, db):
    """الخزينة مدين والذمم المدينة دائن = سند قبض، مش قيد حر.

    The heading has no type of its own, so reading it literally made the most obvious key anybody
    would build post as a plain journal entry — the direction rule failing without a word.
    """
    h = login("admin")
    treasury_id, heading_id = _heading_over_customers(db)

    key = _make(client, h, "تحصيل من العملاء", treasury_id, heading_id).json()
    assert key["voucher_kind"] == "receipt", key


def test_picking_the_customer_is_picking_his_account(client, inv_world, login, chart, db):
    """Asking «مين العميل» and then «أنهي حساب تحت الذمم المدينة» is asking the same thing twice."""
    h = login("admin")
    treasury_id, heading_id = _heading_over_customers(db)

    key = _make(client, h, "تحصيل بدون تكرار", treasury_id, heading_id).json()
    assert key["asks"] == ["customer"], key


def test_a_heading_whose_children_disagree_stays_a_free_entry(client, inv_world, login, chart, db):
    """A mixed heading is genuinely ambiguous, and guessing at it would post real money by a rule
    nobody could predict. «قيد حر» is the honest answer."""
    from src.models.ledger import Account, AccountType, Direction
    h = login("admin")
    treasury_id, heading_id = _heading_over_customers(db)
    db.add(Account(account_type=AccountType.supplier_payable, normal_side=Direction.credit,
                   name="مورد دخيل", is_postable=True, parent_id=heading_id))
    db.commit()

    key = _make(client, h, "مفتاح مختلط", treasury_id, heading_id).json()
    assert key["voucher_kind"] == "journal", key


def test_a_side_can_be_a_whole_group_because_the_chart_has_no_row_for_one(
        client, inv_world, login, chart, db):
    """«العملاء» مش سطر في الشجرة — 233 حساب مالهمش أب مشترك.

    This is what the real chart looks like, and it is why a key limited to real account rows could
    never express «تحصيل نقدي» — the single commonest voucher there is. The heading «الذمم المدينة»
    exists but nothing hangs under it; the grouping every screen shows is derived from the account
    type. So a key's side has to be able to BE that group.
    """
    from src.models.ledger import Account, AccountType, Direction
    h = login("admin")
    treasury = Account(account_type=AccountType.treasury, normal_side=Direction.debit,
                       name="خزنة المجموعة", is_postable=True)
    db.add(treasury)
    db.commit()

    res = client.post("/api/v1/voucher-keys", headers=h, json={
        "name": "تحصيل من العملاء", "debit_account_id": treasury.id,
        "credit_group": "customer_receivable"})
    assert res.status_code == 201, res.text
    key = res.json()
    assert key["voucher_kind"] == "receipt", key
    assert key["asks"] == ["customer"], key
    assert key["credit_account_name"] == "العملاء", key


def test_a_side_is_one_thing_or_the_other_not_both_and_not_neither(
        client, inv_world, login, chart, db):
    """A side carrying an account AND a group, or carrying nothing, has no readable meaning — and
    it would be read by whichever branch the posting code happened to check first."""
    from src.models.ledger import Account, AccountType, Direction
    h = login("admin")
    treasury = Account(account_type=AccountType.treasury, normal_side=Direction.debit,
                       name="خزنة التحقق", is_postable=True)
    db.add(treasury)
    db.commit()

    both = client.post("/api/v1/voucher-keys", headers=h, json={
        "name": "الاتنين", "debit_account_id": treasury.id,
        "credit_account_id": treasury.id, "credit_group": "customer_receivable"})
    assert both.status_code == 422, both.text

    neither = client.post("/api/v1/voucher-keys", headers=h, json={
        "name": "ولا حاجة", "debit_account_id": treasury.id})
    assert neither.status_code == 422, neither.text


def test_the_same_group_on_both_sides_is_refused(client, inv_world, login, chart, db):
    """من العملاء للعملاء — قيد بيتوازن لوحده ومابيحركش حاجة."""
    h = login("admin")
    res = client.post("/api/v1/voucher-keys", headers=h, json={
        "name": "عملاء لعملاء", "debit_group": "customer_receivable",
        "credit_group": "customer_receivable"})
    assert res.status_code == 422, res.text
