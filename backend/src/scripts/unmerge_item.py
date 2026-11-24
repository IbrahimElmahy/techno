from __future__ import annotations

import json
import sys
from datetime import datetime

from sqlalchemy import text

from src.core.db import SessionLocal


def _arg(name: str, default: str | None = None) -> str | None:
    return next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith(f"--{name}=")), default)


def _on_hand(db, ids):
    return db.execute(text(
        "select item_id, location_id, sum(case when direction::text like 'in%' then quantity else -quantity end) "
        "from stock_movement where item_id = any(:ids) and location_kind::text = 'warehouse' "
        "group by 1, 2 order by 1, 2"), {"ids": ids}).all()


def main() -> None:
    execute = "--yes" in sys.argv[1:]
    backup = _arg("backup")
    loser, winner = int(_arg("loser")), int(_arg("winner"))
    loser_code, loser_name = _arg("loser-code"), _arg("loser-name")
    winner_code, winner_name = _arg("winner-code"), _arg("winner-name")
    data = json.load(open(backup, encoding="utf-8"))
    merge = next(m for m in data["merges"] if m["loser"] == loser and m["winner"] == winner)
    db = SessionLocal()
    try:
        print("قبل:", _on_hand(db, [loser, winner]))
        snap = dict(
            items=[dict(r._mapping) for r in db.execute(text(
                "select id, code, name, category, active from item where id = any(:ids)"),
                {"ids": [loser, winner]})],
            resets=[dict(r._mapping) for r in db.execute(text(
                "select * from item_cost_reset where item_id = :w and id = any(:ids)"),
                {"w": winner, "ids": data.get("cost_resets", [])})],
            merge=merge)
        out = f"/tmp/unmerge_{loser}_{winner}_{datetime.now():%Y%m%d-%H%M%S}.json"
        for r in snap["resets"]:
            db.execute(text("delete from item_cost_reset where id = :i"), {"i": r["id"]})
        for u in merge.get("updated", []):
            db.execute(text(f'update "{u["table"]}" set "{u["column"]}" = :v where id = :i'),
                       {"v": u["old"], "i": u["id"]})
        for mv in merge["moved"]:
            n = db.execute(text(f'update "{mv["table"]}" set "{mv["column"]}" = :lo '
                                f'where id = any(:ids) and "{mv["column"]}" = :w'),
                           {"lo": loser, "w": winner, "ids": mv["ids"]}).rowcount
            print(f'{mv["table"]}: {n}/{len(mv["ids"])}')
        for d in merge["deleted"]:
            db.execute(text(f'insert into "{d["table"]}" select * from '
                            f'json_populate_record(null::"{d["table"]}", cast(:js as json))'),
                       {"js": d["row"]})
        category = db.scalar(text("select category from item where id = :i"), {"i": winner})
        db.execute(text("update item set code = :c, name = :n where id = :i"),
                   {"c": f"~U{winner}", "n": winner_name, "i": winner})
        db.execute(text("update item set code = :c, name = :n, category = :cat, active = true "
                        "where id = :i"),
                   {"c": loser_code, "n": loser_name, "cat": category, "i": loser})
        db.execute(text("update item set code = :c where id = :i"), {"c": winner_code, "i": winner})
        db.flush()
        print("بعد:", _on_hand(db, [loser, winner]))
        for r in db.execute(text("select id, code, name, category, active from item "
                                 "where id = any(:ids)"), {"ids": [loser, winner]}):
            print(r)
        if execute:
            with open(out, "w", encoding="utf-8") as fh:
                json.dump(snap, fh, ensure_ascii=False, default=str)
            db.commit()
            print("APPLIED", out)
        else:
            db.rollback()
            print("DRY RUN")
    finally:
        db.close()


if __name__ == "__main__":
    main()
