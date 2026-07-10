"""FastAPI application factory (T008). Registers all foundation routers under /api/v1."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import src.services.loyalty_hooks  # noqa: F401 — registers 002 sale-event subscribers on import
from src.api import (  # Sales & Inventory (002)  # After-Sales Loyalty (003)
    accounting,  # General Ledger (005)
    audit,
    auth,
    catalog,
    cost_centers,  # Cost Centers (006)
    coupons,
    customers,
    loyalty_settings,
    manufacturing,
    org,
    points,
    product_points,
    purchases,
    reports,
    sales,
    settings_lookups,  # Configurable dropdown lists (013)
    stock,
    suppliers,
    transfers,
    treasury,
    users,
    warehouses,
)
from src.api import (
    settings as sales_settings,
)


def create_app() -> FastAPI:
    app = FastAPI(
        title="UBMS Foundation API",
        version="0.1.0",
        description="Foundation (shared base) — the versioned shared contract per Principle II.",
    )

    # Local dev origins + any deployed frontend origins from FRONTEND_ORIGINS (comma-separated),
    # plus a regex allowing Vercel preview/prod domains (*.vercel.app).
    from src.core.config import settings as _settings

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            *_settings.cors_origins,
        ],
        allow_origin_regex=r"https://.*\.vercel\.app",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    prefix = "/api/v1"
    app.include_router(auth.router, prefix=prefix)
    app.include_router(users.router, prefix=prefix)
    app.include_router(org.router, prefix=prefix)
    app.include_router(warehouses.router, prefix=prefix)
    app.include_router(treasury.router, prefix=prefix)
    app.include_router(customers.router, prefix=prefix)
    app.include_router(audit.router, prefix=prefix)
    # Sales & Inventory (002)
    app.include_router(catalog.router, prefix=prefix)
    app.include_router(catalog.lookup_router, prefix=prefix)  # /barcodes/{code} (010)
    app.include_router(stock.router, prefix=prefix)
    app.include_router(suppliers.router, prefix=prefix)
    app.include_router(purchases.router, prefix=prefix)
    app.include_router(manufacturing.router, prefix=prefix)
    app.include_router(sales.router, prefix=prefix)
    app.include_router(transfers.router, prefix=prefix)
    app.include_router(sales_settings.router, prefix=prefix)
    # After-Sales Loyalty (003)
    app.include_router(product_points.router, prefix=prefix)
    app.include_router(loyalty_settings.router, prefix=prefix)
    app.include_router(points.router, prefix=prefix)
    app.include_router(coupons.router, prefix=prefix)
    app.include_router(reports.router, prefix=prefix)
    # General Ledger (005)
    app.include_router(accounting.router, prefix=prefix)
    # Cost Centers (006)
    app.include_router(cost_centers.router, prefix=prefix)
    # Settings → configurable dropdown lists (013)
    app.include_router(settings_lookups.router, prefix=prefix)

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    # Ensure the schema exists on every environment. Render runs scripts.bootstrap, but Vercel
    # serverless has no start command — without this, newly-added tables (BOM, lookups, …) never get
    # created and their endpoints 500 (which surfaces in the browser as a CORS error). create_all is
    # idempotent and additive: it only creates MISSING tables, never alters or drops existing ones.
    try:
        import src.models  # noqa: F401 — populate metadata with every model
        from src.core.db import Base, engine

        Base.metadata.create_all(engine)
        _relax_configurable_enum_columns(engine)
    except Exception as exc:  # pragma: no cover — never let a transient DB hiccup crash boot
        import logging

        logging.getLogger("uvicorn.error").warning("startup create_all skipped: %s", exc)

    return app


def _relax_configurable_enum_columns(engine) -> None:
    """Demote columns whose values are admin-configurable from a native DB ENUM to VARCHAR.

    create_all never alters an existing column, so on a live DB a column first created as a native
    ENUM (Postgres/MySQL) keeps rejecting new values. `customer_type` is a free lookup (013) with no
    logic depending on it — widen it so admins can add their own types. Idempotent and safe; SQLite
    already stores it as text so it is a no-op there.
    """
    import logging

    from sqlalchemy import text

    dialect = engine.dialect.name
    if dialect not in ("postgresql", "postgres", "mysql", "mariadb"):
        return  # sqlite already stores Enum as VARCHAR with no CHECK — nothing to do
    from sqlalchemy import inspect as sa_inspect

    # (table, column, varchar length) pairs that are configurable free lists.
    targets = [("customer", "customer_type", 32)]
    inspector = sa_inspect(engine)
    for table, column, length in targets:
        try:
            col = next((c for c in inspector.get_columns(table) if c["name"] == column), None)
            # Skip when already a plain string — avoids re-running ALTER on every serverless cold start.
            if col is None:
                continue
            type_str = str(col["type"]).upper()
            if "CHAR" in type_str or "TEXT" in type_str:
                continue
            with engine.begin() as conn:
                if dialect in ("postgresql", "postgres"):
                    conn.execute(text(
                        f'ALTER TABLE "{table}" ALTER COLUMN "{column}" '
                        f'TYPE VARCHAR({length}) USING "{column}"::text'
                    ))
                else:  # mysql / mariadb
                    conn.execute(text(
                        f"ALTER TABLE `{table}` MODIFY `{column}` VARCHAR({length}) NOT NULL"
                    ))
        except Exception as exc:  # pragma: no cover — best-effort widening
            logging.getLogger("uvicorn.error").info(
                "relax enum %s.%s skipped: %s", table, column, exc
            )


app = create_app()
