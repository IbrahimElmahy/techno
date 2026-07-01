"""Application settings (T004)."""
from __future__ import annotations

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # SQLite default keeps dev/tests runnable without a live MySQL server.
    # Production overrides via env DATABASE_URL:
    #   MySQL:    mysql+pymysql://user:pass@host:3306/ubms?charset=utf8mb4
    #   Postgres: postgresql+psycopg2://user:pass@host:5432/ubms   (Render/Neon/Supabase)
    database_url: str = "sqlite+pysqlite:///./ubms_dev.sqlite"
    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_ttl: int = 1800  # seconds
    # Comma-separated allowed browser origins for CORS (the deployed frontend).
    frontend_origins: str = ""

    @field_validator("database_url")
    @classmethod
    def _normalize_db_url(cls, v: str) -> str:
        # Render/Heroku hand out `postgres://…`; SQLAlchemy 2.x needs the driver-qualified scheme.
        if v.startswith("postgres://"):
            v = "postgresql+psycopg2://" + v[len("postgres://"):]
        elif v.startswith("postgresql://") and "+psycopg" not in v:
            v = "postgresql+psycopg2://" + v[len("postgresql://"):]
        return v

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.frontend_origins.split(",") if o.strip()]


settings = Settings()
