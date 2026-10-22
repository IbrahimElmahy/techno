from __future__ import annotations

import argparse
from collections import Counter

from sqlalchemy import or_, select

from src.core.db import SessionLocal
from src.models.fleet import Vehicle, VehicleFuel, VehicleMaintenance
from src.models.voucher import Voucher, VoucherKind
from src.services import audit_service, fleet_service


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        accounts = set()
        for v in db.scalars(select(Vehicle)).all():
            accounts.update(a for a in (v.fuel_account_id, v.maintenance_account_id) if a)
        reversed_ids = select(Voucher.reverses_id).where(Voucher.reverses_id.is_not(None))
        linked = select(VehicleFuel.voucher_id).where(VehicleFuel.voucher_id.is_not(None)).union(
            select(VehicleMaintenance.voucher_id).where(VehicleMaintenance.voucher_id.is_not(None)))
        vouchers = db.scalars(select(Voucher).where(
            Voucher.kind == VoucherKind.expense, Voucher.reverses_id.is_(None),
            Voucher.id.not_in(reversed_ids), Voucher.id.not_in(linked),
            Voucher.party_account_id.in_(accounts or {-1}),
            or_(Voucher.reference.is_(None), Voucher.reference.not_like("FLEET-%")),
        ).order_by(Voucher.id)).all()
        summary: Counter = Counter()
        for v in vouchers:
            target = fleet_service.vehicle_for_account(db, v.party_account_id)
            vehicle, model = target
            summary[(vehicle.code, "وقود" if model is VehicleFuel else "صيانة")] += 1
        for (code, kind), n in sorted(summary.items()):
            print(f"{code:<10} {kind:<6} {n}")
        print(f"سندات هتتربط: {len(vouchers)}")
        if not execute:
            print("عرض فقط — أضف --yes للتنفيذ")
            return
        for v in vouchers:
            fleet_service.sync_expense_voucher(db, v)
        touched = {fleet_service.vehicle_for_account(db, v.party_account_id)[0].id for v in vouchers}
        for vid in touched:
            fleet_service.refresh_vehicle(db, db.get(Vehicle, vid))
        audit_service.record(db, action="fleet.link_vouchers", actor_user_id=None,
                             entity_type="fleet", entity_id=0, after={"vouchers": len(vouchers)})
        db.commit()
        print("تم")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="ربط سندات المصروف القديمة بسياراتها حسب الحساب")
    ap.add_argument("--yes", action="store_true")
    run(execute=ap.parse_args().yes)


if __name__ == "__main__":
    main()
