"""Application settings (T004)."""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # SQLite default keeps dev/tests runnable without a live MySQL server.
    # Production overrides via env: mysql+pymysql://user:pass@host:3306/ubms?charset=utf8mb4
    database_url: str = "sqlite+pysqlite:///./ubms_dev.sqlite"
    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_ttl: int = 1800  # seconds


settings = Settings()
