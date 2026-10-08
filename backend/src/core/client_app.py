from __future__ import annotations

from fastapi import Request


def is_mobile_app(request: Request) -> bool:
    return request.headers.get("user-agent", "").startswith("Dart/")
