from __future__ import annotations

from sqlalchemy import inspect, text

from src.core.db import SessionLocal, engine


def run() -> None:
    insp = inspect(engine)
    db = SessionLocal()
    try:
        fixed: list[tuple[str, int, int]] = []
        for t in insp.get_table_names():
            if "id" not in {c["name"] for c in insp.get_columns(t)}:
                continue
            seq = db.execute(text("SELECT pg_get_serial_sequence(:t,'id')"),
                             {"t": t}).scalar()
            if not seq:
                continue
            mx = db.execute(text(f'SELECT COALESCE(max(id),0) FROM "{t}"')).scalar() or 0
            last, called = db.execute(text(f"SELECT last_value, is_called FROM {seq}")).one()
            nxt = last + 1 if called else last
            if nxt <= mx:
                db.execute(text("SELECT setval(:s, :v, true)"), {"s": seq, "v": mx})
                fixed.append((t, nxt, mx + 1))
        db.commit()
        print(f"عدّادات اتظبطت: {len(fixed)}")
        for t, was, now in fixed:
            print(f"   {t:<28} كان هيدّي {was:<8} بقى {now}")
        if not fixed:
            print("   كل العدّادات مظبوطة.")
    finally:
        db.close()


if __name__ == "__main__":
    run()
