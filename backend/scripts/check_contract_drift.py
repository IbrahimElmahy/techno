"""Contract-drift gate (T062). Constitution Principle II.

Asserts the implementation still serves every endpoint promised by the committed shared
contract (specs/001-foundation/contracts/openapi.yaml). Path-parameter names are normalized
so {id} vs {user_id} is not treated as drift; method + path shape must still match.

Exit non-zero on drift. Intended for CI.
Usage: python -m scripts.check_contract_drift
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

from src.main import app

_SPECS = Path(__file__).resolve().parents[2] / "specs"
CONTRACTS = [
    _SPECS / "001-foundation" / "contracts" / "openapi.yaml",
    _SPECS / "002-sales-inventory" / "contracts" / "openapi.yaml",
    _SPECS / "003-after-sales-loyalty" / "contracts" / "openapi.yaml",
    _SPECS / "005-general-ledger" / "contracts" / "openapi.yaml",
    _SPECS / "006-cost-centers-optional" / "contracts" / "openapi.yaml",
    _SPECS / "007-five-sale-price" / "contracts" / "openapi.yaml",
    _SPECS / "008-multiple-units-measure" / "contracts" / "openapi.yaml",
    _SPECS / "009-serial-numbers-per" / "contracts" / "openapi.yaml",
    _SPECS / "010-barcodes-per-item" / "contracts" / "openapi.yaml",
]
_PARAM = re.compile(r"\{[^}]+\}")


def _normalize(path: str) -> str:
    return _PARAM.sub("{}", path)


def _operations(spec: dict, *, server_prefix: str = "") -> set[tuple[str, str]]:
    ops: set[tuple[str, str]] = set()
    for path, item in spec.get("paths", {}).items():
        for method, op in item.items():
            if method.lower() in {"get", "post", "put", "patch", "delete"}:
                ops.add((method.lower(), _normalize(server_prefix + path)))
    return ops


def main() -> int:
    committed_ops: set[tuple[str, str]] = set()
    for contract in CONTRACTS:
        spec = yaml.safe_load(contract.read_text(encoding="utf-8"))
        # Committed contract paths are relative to its server base (/api/v1).
        committed_ops |= _operations(spec, server_prefix="/api/v1")
    generated_ops = _operations(app.openapi())

    missing = committed_ops - generated_ops
    if missing:
        print("CONTRACT DRIFT — implementation is missing contracted operations:")
        for method, path in sorted(missing):
            print(f"  {method.upper()} {path}")
        return 1
    print(f"Contract OK — all {len(committed_ops)} contracted operations are implemented.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
