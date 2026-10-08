from __future__ import annotations

from sqlalchemy import String, TypeDecorator

from src.lib import arabic


class DisplayName(TypeDecorator):
    impl = String
    cache_ok = True

    def process_result_value(self, value, dialect):  # noqa: D102
        return arabic.eastern_digits(value)
