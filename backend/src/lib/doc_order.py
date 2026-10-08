from __future__ import annotations

from sqlalchemy import Date, cast, func


def newest_first(model, date_col):
    return (func.coalesce(date_col, cast(model.created_at, Date)).desc(), model.id.desc())
