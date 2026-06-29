"""T008: chart code/hierarchy rules — child code prefixed by parent; unique; root has no dot."""
import pytest

from src.models.ledger import AccountNature
from src.services import chart_service
from src.services.chart_service import ChartError


def test_child_code_must_be_prefixed_by_parent(chart, db):
    # Valid child under the seeded 5.10 group
    ok = chart_service.create_account(
        db, code="5.10.050", name="كهرباء", nature=AccountNature.expense,
        is_postable=True, parent_id=chart["expense_group"],
    )
    assert ok.parent_id == chart["expense_group"]
    # Bad prefix → rejected
    with pytest.raises(ChartError):
        chart_service.create_account(
            db, code="6.99.001", name="خطأ", nature=AccountNature.expense,
            is_postable=True, parent_id=chart["expense_group"],
        )


def test_duplicate_code_rejected(chart, db):
    with pytest.raises(ChartError):
        chart_service.create_account(
            db, code="5.10.001", name="مكرر", nature=AccountNature.expense,
            is_postable=True, parent_id=chart["expense_group"],
        )


def test_root_account_has_no_dot(chart, db):
    with pytest.raises(ChartError):
        # parent_id None but a dotted code → rejected
        chart_service.create_account(
            db, code="9.1", name="جذر خاطئ", nature=AccountNature.asset,
            is_postable=False, parent_id=None,
        )
    root = chart_service.create_account(
        db, code="9", name="جذر صحيح", nature=AccountNature.asset, is_postable=False, parent_id=None,
    )
    assert root.parent_id is None


def test_parent_must_be_a_group(chart, db):
    # rent (5.10.001) is a postable leaf; cannot be a parent
    with pytest.raises(ChartError):
        chart_service.create_account(
            db, code="5.10.001.1", name="تحت ورقة", nature=AccountNature.expense,
            is_postable=True, parent_id=chart["rent"],
        )
