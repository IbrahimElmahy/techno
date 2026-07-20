"""FastAPI application factory (T008). Registers all foundation routers under /api/v1."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import src.services.loyalty_hooks  # noqa: F401 — registers 002 sale-event subscribers on import
from src.api import (  # Sales & Inventory (002)  # After-Sales Loyalty (003)
    accounting,  # General Ledger (005)
    admin,  # Demo data seeding (system admin)
    audit,
    auth,
    catalog,
    cost_centers,  # Cost Centers (006)
    coupons,
    customers,
    inspections,  # Site inspections / معاينات (015)
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
    vouchers,  # Cash vouchers + statements (018)
    warehouses,
    wastage,
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
    # plus a regex allowing Vercel preview/prod domains and the production technothermeg.com domain.
    from src.core.config import settings as _settings

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "https://app.technothermeg.com",
            "https://technothermeg.com",
            *_settings.cors_origins,
        ],
        # *.vercel.app (previews) OR the technothermeg.com production domain (app/api/apex).
        allow_origin_regex=r"https://(.*\.vercel\.app|(.*\.)?technothermeg\.com)",
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
    # Production reporting (014) — wastage documents
    app.include_router(wastage.router, prefix=prefix)
    # Site inspections / معاينات (015) — rep mobile app
    app.include_router(inspections.router, prefix=prefix)
    # Cash vouchers + account statements (018) — سندات القبض والصرف وكشوف الحساب
    app.include_router(vouchers.router, prefix=prefix)
    # Admin utilities (demo data seeding)
    app.include_router(admin.router, prefix=prefix)

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
        _ensure_columns(engine)
        _widen_columns(engine)
        _relax_configurable_enum_columns(engine)
        _relax_not_null(engine)
    except Exception as exc:  # pragma: no cover — never let a transient DB hiccup crash boot
        import logging

        logging.getLogger("uvicorn.error").warning("startup schema sync skipped: %s", exc)

    return app


# Columns added to EXISTING tables after their first release. create_all only creates missing
# tables, never alters — so on a live DB these are added here (idempotent; checked via inspector).
# Format: (table, column, "<DDL type + default>"). Types are ANSI-ish and work on sqlite/PG/MySQL.
_ADDED_COLUMNS: list[tuple[str, str, str]] = [
    ("item", "default_warehouse_id", "BIGINT"),
    ("manufacturing_order", "material_cost", "NUMERIC(18,2) NOT NULL DEFAULT 0"),
    ("manufacturing_order", "resource_cost", "NUMERIC(18,2) NOT NULL DEFAULT 0"),
    ("manufacturing_order_consumption", "waste_quantity", "NUMERIC(18,3) NOT NULL DEFAULT 0"),
    ("manufacturing_order_consumption", "warehouse_id", "BIGINT"),
    # v4 quick wins
    ("item", "category", "VARCHAR(80)"),
    ("supplier", "address", "VARCHAR(240)"),
    ("customer", "governorate_id", "BIGINT"),
    ("customer", "markaz", "VARCHAR(120)"),
    ("customer", "address", "VARCHAR(240)"),
    ("item", "default_discount_pct", "NUMERIC(5,2) NOT NULL DEFAULT 0"),
    # 015: inspections deduct from the rep's custody when he holds one.
    ("inspection_item", "stock_movement_id", "BIGINT"),
    # 015 review parity: warranty certificate + status + print tracking + نوع الزيارة.
    ("inspection", "certificate_number", "BIGINT"),
    ("inspection", "visit_type", "VARCHAR(40) NOT NULL DEFAULT 'معاينة'"),
    ("inspection", "status", "VARCHAR(12) NOT NULL DEFAULT 'accepted'"),
    ("inspection", "printed", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("inspection", "printed_at", "TIMESTAMP"),
]

# Columns whose TYPE widened after release (create_all never alters). (table, column, PG/MySQL type).
_WIDENED_COLUMNS: list[tuple[str, str, str]] = [
    # v4: points are fractional — "6 pieces = 1 point".
    ("product_point_value", "point_value", "NUMERIC(18,3)"),
    ("point_record", "delta", "NUMERIC(18,3)"),
]


def _widen_columns(engine) -> None:
    """Widen column types introduced after release (e.g. integer points -> fractional). Idempotent."""
    import logging

    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    dialect = engine.dialect.name
    if dialect not in ("postgresql", "postgres", "mysql", "mariadb"):
        return  # sqlite is dynamically typed — nothing to do
    inspector = sa_inspect(engine)
    tables = set(inspector.get_table_names())
    for table, column, ddl_type in _WIDENED_COLUMNS:
        if table not in tables:
            continue
        col = next((c for c in inspector.get_columns(table) if c["name"] == column), None)
        if col is None or "NUMERIC" in str(col["type"]).upper() or "DECIMAL" in str(col["type"]).upper():
            continue  # already widened
        try:
            with engine.begin() as conn:
                if dialect in ("postgresql", "postgres"):
                    conn.execute(text(
                        f'ALTER TABLE {table} ALTER COLUMN {column} TYPE {ddl_type} '
                        f'USING {column}::numeric'))
                else:
                    conn.execute(text(f"ALTER TABLE `{table}` MODIFY `{column}` {ddl_type} NOT NULL"))
        except Exception as exc:  # pragma: no cover — best-effort
            logging.getLogger("uvicorn.error").info(
                "widen %s.%s skipped: %s", table, column, exc)


# FK columns that are inserted with a temporary NULL before the referenced row exists (Postgres
# enforces FKs immediately; a 0 placeholder violated the constraint → invoices/production failed on
# the live DB). The model is now nullable; drop NOT NULL on existing databases too. (table, column).
_NULLABLE_FK_COLUMNS: list[tuple[str, str]] = [
    ("purchase_invoice", "ledger_entry_id"),
    ("purchase_return", "ledger_entry_id"),
    ("sales_invoice", "ledger_entry_id"),
    ("sales_return", "ledger_entry_id"),
    ("manufacturing_op", "stock_movement_id"),
    ("manufacturing_order", "stock_movement_id"),
    ("manufacturing_order_consumption", "stock_movement_id"),
    ("wastage_document", "stock_movement_id"),
]


def _relax_not_null(engine) -> None:
    """Drop NOT NULL on FK columns filled in after insert (see note above). Idempotent."""
    import logging

    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    dialect = engine.dialect.name
    if dialect not in ("postgresql", "postgres", "mysql", "mariadb"):
        return  # sqlite doesn't enforce these FKs / NOT NULL matters less; nothing to do
    inspector = sa_inspect(engine)
    tables = set(inspector.get_table_names())
    for table, column in _NULLABLE_FK_COLUMNS:
        if table not in tables:
            continue
        col = next((c for c in inspector.get_columns(table) if c["name"] == column), None)
        if col is None or col.get("nullable", True):
            continue  # already nullable — skip
        try:
            with engine.begin() as conn:
                if dialect in ("postgresql", "postgres"):
                    conn.execute(text(f'ALTER TABLE {table} ALTER COLUMN {column} DROP NOT NULL'))
                else:  # mysql / mariadb
                    conn.execute(text(f"ALTER TABLE `{table}` MODIFY `{column}` BIGINT NULL"))
        except Exception as exc:  # pragma: no cover — best-effort
            logging.getLogger("uvicorn.error").info(
                "relax not-null %s.%s skipped: %s", table, column, exc
            )


def _ensure_columns(engine) -> None:
    """Add columns introduced on existing tables (create_all won't alter). Idempotent."""
    import logging

    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    inspector = sa_inspect(engine)
    existing_tables = set(inspector.get_table_names())
    for table, column, ddl in _ADDED_COLUMNS:
        if table not in existing_tables:
            continue
        cols = {c["name"] for c in inspector.get_columns(table)}
        if column in cols:
            continue
        try:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
        except Exception as exc:  # pragma: no cover — best-effort
            logging.getLogger("uvicorn.error").info(
                "ensure column %s.%s skipped: %s", table, column, exc
            )


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
