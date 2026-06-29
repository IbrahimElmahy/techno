"""T062: the contract-drift gate passes for the current implementation."""
from scripts.check_contract_drift import main


def test_no_contract_drift():
    assert main() == 0
