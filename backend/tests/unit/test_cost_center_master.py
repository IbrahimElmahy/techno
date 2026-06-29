"""T006: cost-center master rules — unique code, child-under-parent, deactivate-not-delete."""
import pytest

from src.models.cost_center import CostCenter
from src.services import cost_center_service
from src.services.cost_center_service import CostCenterError


def test_unique_code_enforced(cost_centers, db):
    with pytest.raises(CostCenterError):
        cost_center_service.create(db, code="1.01", name="مكرر")


def test_parent_must_exist(cost_centers, db):
    with pytest.raises(CostCenterError):
        cost_center_service.create(db, code="9.99", name="يتيم", parent_id=999999)


def test_child_nests_under_parent(cost_centers, db):
    child = cost_center_service.create(db, code="1.01.001", name="قسم", parent_id=cost_centers["cc_nasr"])
    assert child.parent_id == cost_centers["cc_nasr"]


def test_deactivate_not_delete(cost_centers, db):
    cost_center_service.deactivate(db, cost_center_id=cost_centers["cc_maadi"])
    cc = db.get(CostCenter, cost_centers["cc_maadi"])
    assert cc is not None and cc.active is False  # row preserved, just inactive


def test_cannot_deactivate_with_active_children(cost_centers, db):
    with pytest.raises(CostCenterError):
        cost_center_service.deactivate(db, cost_center_id=cost_centers["cc_root"])


def test_is_active_helper(cost_centers, db):
    assert cost_center_service.is_active(db, cost_centers["cc_nasr"]) is True
    cost_center_service.deactivate(db, cost_center_id=cost_centers["cc_nasr"])
    assert cost_center_service.is_active(db, cost_centers["cc_nasr"]) is False
