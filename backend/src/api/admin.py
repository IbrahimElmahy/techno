"""Admin utilities — demo data seeding, company-data import and the integrity check.

Admin-only because the integrity report names internal ids and would read as alarming to anyone who
does not know what the invariants are.
"""
from __future__ import annotations

import tempfile

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, get_current_user
from src.core.db import get_db
from src.models.role import RoleName
from src.scripts.demo_seed import seed_demo
from src.scripts.import_company_data import import_workbook
from src.scripts.purge_demo import purge_demo as _purge_demo

router = APIRouter(tags=["admin"], prefix="/admin")


def _require_admin(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if current.role != RoleName.system_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "System admin only."})
    return current


@router.post("/demo-seed")
def demo_seed(
    _: CurrentUser = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
    """Populate a full demo dataset (idempotent) for testing every module."""
    try:
        return seed_demo(db)
    except Exception as exc:  # surface a clean error instead of a 500 with no CORS
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "seed_failed", "message": str(exc)}) from exc


@router.post("/import-company-data")
async def import_company_data(
    file: UploadFile = File(...),
    _: CurrentUser = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
    """Import the company's master data from the client's Excel workbook.

    Idempotent: items/warehouses/customers already present (matched by name) are skipped, so
    re-uploading the same file only adds what is missing.
    """
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(422, {"code": "validation", "message": "Upload an .xlsx workbook."})
    data = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        return import_workbook(db, tmp_path)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "import_failed", "message": str(exc)}) from exc


@router.delete("/demo-seed")
def purge_demo_data(
    _: CurrentUser = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
    """Delete the demo dataset (and only it) so a production database is left with real data.

    Hard delete by design — the app is append-only everywhere else; this is the deliberate
    exception for clearing sample data before go-live.
    """
    try:
        return _purge_demo(db)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "purge_failed", "message": str(exc)}) from exc


@router.get("/integrity")
def integrity_check(
    _: CurrentUser = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
    """فحص سلامة البيانات — read-only.

    Their أدوات خاصة *repairs* recomputed balances. Ours has nothing to recompute: on-hand is always
    summed from the movements, never cached, so it cannot go stale. What this checks is the two
    things that genuinely are stored beside the movements — expiry lots and serial numbers — plus
    the two invariants everything else rests on: no negative stock anywhere, and every ledger entry
    balanced.

    It reports and repairs nothing, deliberately. A finding here means some code path wrote one side
    without the other, and quietly correcting the numbers would hide the defect that produced them —
    the next occurrence would be corrected just as quietly, and nobody would ever learn why the
    counts drifted.
    """
    from src.lib import integrity

    report = integrity.run_all(db)
    return {
        "clean": report.clean,
        "checked": report.checked,
        "findings": [
            {
                "check": f.check, "subject": f.subject, "expected": f.expected,
                "found": f.found, "detail": f.detail,
            }
            for f in report.findings
        ],
    }


@router.post("/merge-customers")
def merge_customers(
    apply: bool = False,
    limit: int | None = None,
    _: CurrentUser = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
    """دمج «تكنو فلان» مع «فلان» — على القاعدة اللي السيرفر ده شغال عليها.

    The merge has existed as a service for a while and could only ever be run against a developer's
    own database. A push deploys code and does nothing to data, so production kept its duplicated
    customers while every local copy had them joined — a difference that is invisible from outside
    and reads as «the work was never deployed».

    This runs it where the data actually is. No credential has to leave the host to do it, which is
    the point: the server already holds the connection.

    **`apply` defaults to false.** The dangerous call is the one you have to ask for. Without it
    this reports exactly what a merge would do and writes nothing.

    **`limit` merges that many at a time and reports `remaining`.** Doing all 86 in one request kept
    returning 503 from a platform that caps request duration; in batches the cap stops mattering.
    A merge is per-customer and independent, so a batch that stops early leaves the rest exactly
    where they were rather than half-done.

    **And it will not leave the books different from how it found them.** A merge moves a POINTER —
    the duplicate's ledger account becomes the بولي account of the surviving customer, carrying its
    history untouched — so the sum over every customer's ledger account has to come out identical.
    It is totalled before and after and the whole thing is rolled back if they disagree, inside the
    transaction, where a wrong answer is still a refusal rather than a mess.
    """
    from decimal import Decimal

    from sqlalchemy import select

    from src.models.customer import CustomerAccount
    from src.services import customer_merge_service, ledger_service

    def total_receivable() -> Decimal:
        # Read from the LEDGER side: a customer account has no balance of its own, it points at a
        # ledger account, and the pointer is the thing being moved.
        #
        # One aggregate query, not one per account. Looping `balance_of` over 233 accounts twice —
        # before and after — pulled every ledger line in the system across the wire and took the
        # request past the serverless timeout: the merge answered 503 having done nothing.
        return ledger_service.total_balance_of(
            db, db.scalars(select(CustomerAccount.account_id)).all())

    before = total_receivable()
    result = customer_merge_service.apply(db, dry_run=not apply, limit=limit)
    result["balance_before"] = str(before)

    if not apply:
        db.rollback()
        result["balance_after"] = str(before)
        return result

    after = total_receivable()
    result["balance_after"] = str(after)
    if after != before:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, {
            "code": "merge_changed_balances",
            "message": (f"الدمج اترفض: أرصدة العملاء اتغيّرت من {before} لـ {after}. "
                        "مفيش حاجة اتحفظت."),
        })

    db.commit()
    return result
