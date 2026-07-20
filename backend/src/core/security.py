"""Password hashing and JWT issue/verify (T027). Research R5."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
from jose import JWTError, jwt

from src.core.config import settings


def hash_password(plain: str) -> str:
    # bcrypt caps input at 72 bytes; truncate deterministically.
    return bcrypt.hashpw(plain.encode("utf-8")[:72], bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8")[:72], hashed.encode("utf-8"))


def create_access_token(claims: dict[str, Any], ttl_seconds: int | None = None) -> str:
    to_encode = dict(claims)
    expire = datetime.now(UTC) + timedelta(seconds=ttl_seconds or settings.access_token_ttl)
    to_encode["exp"] = expire
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None
