"""T027: trial balance report — opening+movement+closing, group roll-up, branch filter, totals."""


def _post(client, h, chart, branch_id, debit, credit, amount, d="2026-06-10"):
    return client.post("/api/v1/journal-entries", headers=h, json={
        "date": d, "description": "t", "branch_id": branch_id,
        "lines": [
            {"account_id": debit, "direction": "debit", "amount": amount},
            {"account_id": credit, "direction": "credit", "amount": amount},
        ],
    })


def test_report_totals_and_group_rollup(chart, client, login):
    h = login("acct")
    _post(client, h, chart, chart["branch_a"], chart["rent"], chart["treasury"], "1000.00")
    _post(client, h, chart, chart["branch_a"], chart["salaries"], chart["treasury"], "500.00")

    resp = client.get(
        "/api/v1/trial-balance?from=2026-01-01&to=2026-12-31&include_groups=true", headers=h
    )
    assert resp.status_code == 200, resp.text
    tb = resp.json()
    assert tb["balanced"] is True
    assert tb["grand_total_debit"] == tb["grand_total_credit"] == "1500.00"

    rows = {r["account_id"]: r for r in tb["rows"]}
    # the 5.10 expense group rolls up rent+salaries = 1500 debit movement
    grp = rows[chart["expense_group"]]
    assert grp["is_postable"] is False
    assert grp["period_debit"] == "1500.00"


def test_branch_filter_scopes_results(chart, client, login):
    h = login("acct")  # company-wide accountant (admin? no — accountant, not admin)
    _post(client, h, chart, chart["branch_a"], chart["rent"], chart["treasury"], "1000.00")
    _post(client, h, chart, chart["branch_b"], chart["salaries"], chart["treasury"], "700.00")

    # admin can scope by branch explicitly
    ha = login("admin")
    only_b = client.get(
        f"/api/v1/trial-balance?from=2026-01-01&to=2026-12-31&branch_id={chart['branch_b']}",
        headers=ha,
    ).json()
    rows = {r["account_id"]: r for r in only_b["rows"]}
    assert chart["salaries"] in rows
    assert chart["rent"] not in rows  # branch A excluded


def test_branch_scoped_accountant_sees_only_own_branch(chart, client, login):
    h_all = login("acct")
    _post(client, h_all, chart, chart["branch_a"], chart["rent"], chart["treasury"], "1000.00")
    _post(client, h_all, chart, chart["branch_b"], chart["salaries"], chart["treasury"], "700.00")

    h = login("acct_a")  # branch_a scoped
    tb = client.get("/api/v1/trial-balance?from=2026-01-01&to=2026-12-31", headers=h).json()
    rows = {r["account_id"]: r for r in tb["rows"]}
    assert chart["rent"] in rows
    assert chart["salaries"] not in rows  # branch B hidden
