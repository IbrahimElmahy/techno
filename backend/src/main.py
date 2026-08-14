"""FastAPI application factory (T008). Registers all foundation routers under /api/v1."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import src.services.loyalty_hooks  # noqa: F401 — registers 002 sale-event subscribers on import
from src.api import (  # Sales & Inventory (002)  # After-Sales Loyalty (003)
    accounting,  # General Ledger (005)
    admin,  # Demo data seeding (system admin)
    attachments,  # مرفقات الزيارات (صور المندوب)
    audit,
    auth,
    catalog,
    cheques,  # Cheques + financial statements + aging (020)
    cost_centers,  # Cost Centers (006)
    coupons,
    customers,
    inspections,  # Site inspections / معاينات (015)
    loyalty_settings,
    coupon_receipts,  # استلام الكوبونات من العملاء
    employees,  # الموظفون والوظائف (B8)
    hr,  # الموارد البشرية — الأقسام ونهاية الخدمة (HR-1)
    fixed_assets,  # الأصول الثابتة والإهلاك (B6)
    manufacturing,
    orders,  # طلبات البيع والشراء (B9)
    org,
    points,
    price_display,  # شاشة معلومات المنتج (031)
    product_points,
    purchases,
    reports,
    voucher_keys,
    rep_reports,
    reservations,  # حجز عملاء (031)  # تقارير مندوبين (031)
    sales,
    serials,  # السرايل و حركات سرايل (031)
    settings_lookups,  # Configurable dropdown lists (013)
    stock,
    stock_counts,  # جرد المخازن (031)
    suppliers,
    tax_commissions,  # VAT return + rep commissions (021)
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
    app.include_router(serials.router, prefix=prefix)
    app.include_router(rep_reports.router, prefix=prefix)
    app.include_router(reservations.router, prefix=prefix)
    app.include_router(stock_counts.router, prefix=prefix)
    app.include_router(price_display.router, prefix=prefix)
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
    app.include_router(voucher_keys.router, prefix=prefix)
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
    # Cheques + income statement / balance sheet / aging (020)
    app.include_router(cheques.router, prefix=prefix)
    # VAT return + rep commissions (021)
    app.include_router(tax_commissions.router, prefix=prefix)
    # Fixed assets + depreciation (B6)
    app.include_router(fixed_assets.router, prefix=prefix)
    # Employees + job titles (B8)
    app.include_router(employees.router, prefix=prefix)
    # الموارد البشرية — الأقسام ونهاية الخدمة (HR-1)
    app.include_router(hr.router, prefix=prefix)
    # Sales / purchase orders (B9)
    app.include_router(orders.router, prefix=prefix)
    # Coupon hand-back from customers (mobile app + office)
    app.include_router(coupon_receipts.router, prefix=prefix)
    app.include_router(attachments.router, prefix=prefix)
    # Admin utilities (demo data seeding)
    app.include_router(admin.router, prefix=prefix)

    @app.get("/health")
    def health() -> dict:
        """«شغّال» — ومن أنهي نسخة.

        `{"status": "ok"}` answers whether the process is up, which was never the question anybody
        actually had. A whole day went into «is this deployed?» while the API answered ok from a
        build four commits old: the site was healthy and stale at the same time, and there was no
        way to tell the two apart from outside.

        The commit is read from the platform's own environment rather than from anything committed
        to the repository, so it cannot go stale the way a hand-maintained version string does —
        the thing reporting the build is the thing that made it.

        `routes` is the cheap second opinion. A number that has not moved after a deploy says the
        backend did not rebuild, without needing the whole schema fetched and diffed.
        """
        import os

        sha = (os.getenv("VERCEL_GIT_COMMIT_SHA") or os.getenv("RENDER_GIT_COMMIT")
               or os.getenv("GIT_COMMIT") or "")
        return {
            "status": "ok",
            "commit": sha[:7] if sha else "unknown",
            "routes": len(app.openapi().get("paths", {})),
        }

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
        _ensure_customer_account_family(engine)
        _relax_configurable_enum_columns(engine)
        _relax_not_null(engine)
        _backfill_branch(engine)
        _migrate_appears_in(engine)
    except Exception as exc:  # pragma: no cover — never let a transient DB hiccup crash boot
        import logging

        logging.getLogger("uvicorn.error").warning("startup schema sync skipped: %s", exc)

    return app


# Columns added to EXISTING tables after their first release. create_all only creates missing
# tables, never alters — so on a live DB these are added here (idempotent; checked via inspector).
# Format: (table, column, "<DDL type + default>"). Types are ANSI-ish and work on sqlite/PG/MySQL.
_ADDED_COLUMNS: list[tuple[str, str, str]] = [
    # (HR-1) «القسم» بقى جدول. نفس شكل ("employee","warehouse_id","BIGINT") اللي عدّى قبل كده:
    # nullable، من غير default، ومن غير FK في نص الـDDL — أي حاجة فيها NOT NULL DEFAULT بتختلف
    # من لهجة للتانية، والفشل هنا بيتبلع عند مستوى info فبيفضل غلط في صمت.
    ("employee", "department_id", "BIGINT"),
    # (035) «محل الشراء» بقى تاجر مختار من قايمة المندوب، وتليفونه بيتسجّل معاه.
    ("inspection", "purchase_shop_phone", "VARCHAR(40)"),
    # (034) فاتورة الشرا بقت نسخة من البيع: خصم على السطر، خصم على الفاتورة، وضريبة.
    ("purchase_invoice", "gross", "DECIMAL(18,2)"),
    ("purchase_invoice", "fixed_discount_pct", "DECIMAL(9,4)"),
    ("purchase_invoice", "variable_discount_pct", "DECIMAL(9,4)"),
    ("purchase_invoice", "combined_pct", "DECIMAL(9,4)"),
    ("purchase_invoice", "net", "DECIMAL(18,2)"),
    ("purchase_invoice", "tax_amount", "DECIMAL(18,2)"),
    ("purchase_invoice_line", "discount_pct", "DECIMAL(9,4)"),
    # (033) اللي المندوب قاله عن الكوبونات على الجهاز — بيوصل مع المزامنة.
    ("coupon_receipt", "declared_kind", "VARCHAR(24)"),
    ("coupon_receipt", "declared_value", "DECIMAL(18,2)"),
    ("coupon_receipt", "customer_type", "VARCHAR(16)"),
    # (032) A voucher key's side may be a whole group instead of one account — «العملاء» is not a
    # row in this chart, it is an account_type shared by every customer's account.
    ("voucher_key", "debit_group", "VARCHAR(40)"),
    ("voucher_key", "credit_group", "VARCHAR(40)"),
    # (031) The day the goods came back. `created_at` is when the row was typed, which is often
    # days later — a Saturday return entered on Monday would land in the wrong week on every
    # report that groups by day.
    ("sales_return", "return_date", "DATE"),
    ("purchase_invoice", "purchase_date", "DATE"),
    ("purchase_return", "return_date", "DATE"),
    # (031) One receivable account per product family. NULL = the customer's original account.
    ("customer_account", "family", "VARCHAR(40)"),
    ("customer_account", "commission_pct", "DECIMAL(9,4)"),
    ("sales_invoice", "family", "VARCHAR(40)"),
    ("sales_return", "family", "VARCHAR(40)"),
    # (011) Which expiry lot a permit line touched, so its reversal undoes the same one.
    ("stock_permit_line", "expiry_date", "DATE"),
    ("voucher", "family", "VARCHAR(40)"),
    ("customer", "default_return_warehouse_id", "BIGINT"),
    ("stock_transfer", "reject_reason", "VARCHAR(240)"),
    ("stock_count", "kind", "VARCHAR(16) NOT NULL DEFAULT 'full'"),
    ("purchase_return", "notes", "VARCHAR(500)"),
    # Customer card fields read off their العملاء form. discount/VAT stay nullable on purpose:
    # NULL is «nothing agreed», 0 is «agreed, and it is zero».
    ("customer", "branch_id", "BIGINT"),
    ("customer", "email", "VARCHAR(160)"),
    ("customer", "tax_number", "VARCHAR(40)"),
    ("customer", "commercial_register", "VARCHAR(40)"),
    ("customer", "discount_pct", "DECIMAL(5,2)"),
    ("customer", "vat_pct", "DECIMAL(5,2)"),
    ("customer", "is_cash", "BOOLEAN DEFAULT FALSE NOT NULL"),
    # «بيان ١» و«بيان ٢» off their الفروع form — two free note lines on the branch.
    ("branch", "note1", "VARCHAR(300)"),
    ("branch", "note2", "VARCHAR(300)"),
    # Supplier card fields read off their الموردين form. No discount/VAT/tier: their supplier
    # form has none of the three, unlike their customer form.
    ("supplier", "supplier_type", "VARCHAR(32)"),
    ("supplier", "email", "VARCHAR(160)"),
    ("supplier", "tax_number", "VARCHAR(40)"),
    ("supplier", "commercial_register", "VARCHAR(40)"),
    ("supplier", "is_cash", "BOOLEAN DEFAULT FALSE NOT NULL"),
    # Employee card fields read off their الموظفين form.
    ("employee", "address", "VARCHAR(240)"),
    ("employee", "work_start", "VARCHAR(20)"),
    ("employee", "work_end", "VARCHAR(20)"),
    ("employee", "collection_commission_pct", "DECIMAL(5,2)"),
    # «قفل تعديل المستندات (أيام)» (a5 parity: اعدادات القاعدة).
    ("sales_setting", "edit_lock_days", "INT"),
    # Production document header (a5 parity: انتاج حسب النسب).
    ("manufacturing_order", "production_date", "DATE"),
    ("manufacturing_order", "branch_id", "BIGINT"),
    ("manufacturing_order", "work_order_ref", "VARCHAR(60)"),
    ("manufacturing_order", "notes", "VARCHAR(500)"),
    # The unit a recipe component is written in (a5 parity: نسب انتاج ← الوحدة).
    ("bom_component", "unit", "VARCHAR(16)"),
    ("bom_component", "unit_factor", "DECIMAL(18,3) NOT NULL DEFAULT 1"),
    # «المستوى الرئيسي» on a chart account (a5 parity).
    ("account", "main_level", "VARCHAR(80)"),
    # Master-data parity: the supplier's location, the store's note, the employee's store.
    ("supplier", "branch_id", "BIGINT"),
    ("supplier", "governorate_id", "BIGINT"),
    ("supplier", "markaz", "VARCHAR(120)"),
    ("warehouse", "description", "VARCHAR(300)"),
    ("employee", "warehouse_id", "BIGINT"),
    # Item packing + note, and per-tier allowances (a5 parity).
    ("item", "piece_name", "VARCHAR(32)"),
    ("item", "pieces_per_unit", "DECIMAL(18,3)"),
    ("item", "description", "VARCHAR(500)"),
    ("item_price", "discount_pct", "DECIMAL(5,2)"),
    ("item_price", "vat_pct", "DECIMAL(5,2)"),
    # A free note on a configurable list option (a5 parity: فئات الأصناف have a وصف).
    ("lookup_option", "description", "VARCHAR(300)"),
    # Invoice expense totals (a5 parity): billed to the customer vs borne by us.
    ("sales_invoice", "expenses_billed", "DECIMAL(18,2)"),
    ("sales_invoice", "expenses_operating", "DECIMAL(18,2)"),
    # The day the sale happened (drives the ledger entry date too).
    ("sales_invoice", "invoice_date", "DATE"),
    # Coupon serial range issued with a sale (the mobile app reads it on hand-back).
    ("sales_invoice", "coupon_serial_from", "VARCHAR(24)"),
    ("sales_invoice", "coupon_serial_to", "VARCHAR(24)"),
    ("sales_invoice", "coupon_count", "INTEGER"),
    # «يظهر في» — statement presentation override (B8).
    ("account", "appears_in", "VARCHAR(24)"),
    ("item", "default_warehouse_id", "BIGINT"),
    ("sales_invoice_line", "discount_pct", "NUMERIC(5,2) NOT NULL DEFAULT 0"),
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
    # 024: per-branch chart of accounts.
    ("account", "branch_id", "BIGINT"),
    # 015: inspections deduct from the rep's custody when he holds one.
    ("inspection_item", "stock_movement_id", "BIGINT"),
    # 022: a regular visit links to a chosen customer.
    ("inspection", "customer_id", "BIGINT"),
    # 021: opt-in VAT (rate 0 = off) and the tax charged on each sale.
    ("sales_setting", "vat_rate_pct", "NUMERIC(5,2) NOT NULL DEFAULT 0"),
    ("sales_invoice", "tax_amount", "NUMERIC(18,2) NOT NULL DEFAULT 0"),
    # 019: vouchers can name the safe the cash moved through.
    ("voucher", "treasury_id", "BIGINT"),
    ("voucher", "to_treasury_id", "BIGINT"),
    # 015 review parity: warranty certificate + status + print tracking + نوع الزيارة.
    ("inspection", "certificate_number", "BIGINT"),
    ("inspection", "visit_type", "VARCHAR(40) NOT NULL DEFAULT 'معاينة'"),
    ("inspection", "status", "VARCHAR(12) NOT NULL DEFAULT 'accepted'"),
    ("inspection", "printed", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("inspection", "printed_at", "TIMESTAMP"),
    # 028: standalone sales returns ("return like a sale, reversed") — the invoice link becomes
    # optional and the return carries its own customer/location/cash + priced lines.
    ("sales_return", "customer_id", "BIGINT"),
    ("sales_return", "origin_location_kind", "VARCHAR(20)"),
    ("sales_return", "origin_location_id", "BIGINT"),
    ("sales_return", "gross", "NUMERIC(18,2) NOT NULL DEFAULT 0"),
    ("sales_return", "combined_pct", "NUMERIC(5,2) NOT NULL DEFAULT 0"),
    ("sales_return", "tax_amount", "NUMERIC(18,2) NOT NULL DEFAULT 0"),
    ("sales_return", "cash_account_id", "BIGINT"),
    ("sales_return_line", "unit_price", "NUMERIC(18,2)"),
    ("sales_return_line", "discount_pct", "NUMERIC(5,2) NOT NULL DEFAULT 0"),
    ("sales_return_line", "line_total", "NUMERIC(18,2)"),
    ("sales_return_line", "unit", "VARCHAR(16)"),
    ("sales_return_line", "unit_factor", "NUMERIC(18,3) NOT NULL DEFAULT 1"),
    # 030: the warehouse moves from the document down to the line, the sale freezes its cost,
    # and the document gains rep / posting account / the customer's own paper number + notes.
    ("sales_invoice_line", "location_kind", "VARCHAR(20)"),
    ("sales_invoice_line", "location_id", "BIGINT"),
    ("sales_invoice_line", "unit_cost", "NUMERIC(18,2)"),
    ("sales_return_line", "location_kind", "VARCHAR(20)"),
    ("sales_return_line", "location_id", "BIGINT"),
    ("sales_return_line", "unit_cost", "NUMERIC(18,2)"),
    ("purchase_invoice_line", "line_location_kind", "VARCHAR(20)"),
    ("purchase_invoice_line", "line_location_id", "BIGINT"),
    ("sales_invoice", "rep_id", "BIGINT"),
    ("sales_invoice", "revenue_account_id", "BIGINT"),
    ("sales_invoice", "external_document_number", "VARCHAR(40)"),
    ("sales_invoice", "notes", "VARCHAR(500)"),
    ("sales_invoice", "statement1", "VARCHAR(200)"),
    ("sales_invoice", "statement2", "VARCHAR(200)"),
    ("sales_invoice", "statement3", "VARCHAR(200)"),
    ("sales_return", "rep_id", "BIGINT"),
    ("sales_return", "revenue_account_id", "BIGINT"),
    ("sales_return", "external_document_number", "VARCHAR(40)"),
    ("sales_return", "notes", "VARCHAR(500)"),
    ("sales_return", "statement1", "VARCHAR(200)"),
    ("sales_return", "statement2", "VARCHAR(200)"),
    ("sales_return", "statement3", "VARCHAR(200)"),
    ("purchase_invoice", "rep_id", "BIGINT"),
    ("purchase_invoice", "expense_account_id", "BIGINT"),
    ("purchase_invoice", "external_document_number", "VARCHAR(40)"),
    ("purchase_invoice", "notes", "VARCHAR(500)"),
    ("purchase_invoice", "statement1", "VARCHAR(200)"),
    ("purchase_invoice", "statement2", "VARCHAR(200)"),
    ("purchase_invoice", "statement3", "VARCHAR(200)"),
    # 011: advisory min/max limits + the perishable flag (stock_batch is a new table, so
    # create_all handles it).
    ("item", "min_stock", "NUMERIC(18,3)"),
    ("item", "max_stock", "NUMERIC(18,3)"),
    ("item", "is_perishable", "BOOLEAN NOT NULL DEFAULT FALSE"),
]

# Columns whose TYPE widened after release (create_all never alters). (table, column, PG/MySQL type).
_WIDENED_COLUMNS: list[tuple[str, str, str]] = [
    # A sixth price tier (سعر اللستة) added after release; MySQL stores this as a native ENUM.
    ("item_price", "tier",
     "ENUM('commercial','semi_commercial','wholesale','semi_wholesale','consumer','list_price')"),
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
    # 028: standalone returns have no originating invoice.
    ("sales_return", "sales_invoice_id"),
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


def _backfill_branch(engine) -> None:
    """Home every branch-less account to the company's main branch (024). Idempotent.

    Runs once after the branch_id column is added: existing balances stay exactly where they
    are — they just gain a branch — so a single-branch company behaves identically.
    """
    import logging

    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import func, select, update

    inspector = sa_inspect(engine)
    tables = set(inspector.get_table_names())
    if "account" not in tables or "branch" not in tables:
        return
    if "branch_id" not in {c["name"] for c in inspector.get_columns("account")}:
        return
    from src.core.db import SessionLocal
    from src.models.ledger import Account
    from src.services import org_service

    db = SessionLocal()
    try:
        pending = db.scalar(
            select(func.count()).select_from(Account).where(Account.branch_id.is_(None))
        ) or 0
        if not pending:
            return
        branch_id = org_service.default_branch(db).id
        db.execute(update(Account).where(Account.branch_id.is_(None)).values(branch_id=branch_id))
        db.commit()
        logging.getLogger("uvicorn.error").info(
            "multi-branch backfill: homed %s accounts to branch %s", pending, branch_id)
    except Exception as exc:  # pragma: no cover — best-effort
        db.rollback()
        logging.getLogger("uvicorn.error").info("branch backfill skipped: %s", exc)
    finally:
        db.close()


def _migrate_appears_in(engine) -> None:
    """Move accounts off the collapsed «income_statement» onto أرباح وخسائر. Idempotent.

    «يظهر في» used to take one income-statement value; Egyptian practice prints two — المتاجرة
    down to gross profit and أرباح وخسائر down to net profit — so the single value became a lie
    about which statement the account appears on.

    Old rows land on profit_loss rather than trading because that is the safer wrong answer: an
    account wrongly on المتاجرة would inflate cost of sales and move gross profit, while one
    wrongly on أرباح وخسائر only sits lower down the same statement. Migrations run on a real
    deployment; this covers the serverless one, where they do not.
    """
    import logging

    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    inspector = sa_inspect(engine)
    if "account" not in set(inspector.get_table_names()):
        return
    if "appears_in" not in {c["name"] for c in inspector.get_columns("account")}:
        return
    try:
        with engine.begin() as conn:
            conn.execute(text(
                "UPDATE account SET appears_in = 'profit_loss' "
                "WHERE appears_in = 'income_statement'"))
    except Exception as exc:  # pragma: no cover — best-effort
        logging.getLogger("uvicorn.error").info("appears_in migration skipped: %s", exc)


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


def _drop_unique_sql(dialect: str, table: str, name: str) -> str:
    """The statement that removes a UNIQUE constraint, in the dialect's own spelling.

    Pulled out so it can be checked directly, because getting it wrong is silent. This said
    `DROP INDEX` unconditionally — MySQL's spelling — and the Postgres server rejected it, the
    failure was swallowed, and the old «one account per customer» constraint stayed in place for
    months. Everything passed locally against MySQL; the merge died on the server every time.
    """
    if dialect.startswith("postgres"):
        return f"ALTER TABLE {table} DROP CONSTRAINT {name}"
    return f"ALTER TABLE {table} DROP INDEX {name}"


def _ensure_customer_account_family(engine) -> None:
    """Let a customer hold one receivable account PER PRODUCT FAMILY. Idempotent.

    `create_all` never alters an existing table and this database is synced at startup rather than
    by alembic, so a constraint change has to be made here or it simply never happens on a running
    server. And this one is not cosmetic: the old `UNIQUE (customer_id)` is precisely what forced
    the client to open a customer twice to give him two accounts, so leaving it in place would let
    the merge pass its tests and fail on the server with a duplicate-key error.

    Both steps are guarded by inspection rather than by name: the old constraint was created by
    different tools on different installs and does not have one predictable name.
    """
    import logging

    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    log = logging.getLogger("uvicorn.error")
    inspector = sa_inspect(engine)
    if "customer_account" not in set(inspector.get_table_names()):
        return
    try:
        constraints = inspector.get_unique_constraints("customer_account")
    except Exception as exc:  # pragma: no cover — best-effort
        log.info("customer_account constraints unreadable: %s", exc)
        return

    names = {c["name"] for c in constraints}
    # `DROP INDEX` is MySQL's spelling and `DROP CONSTRAINT` is the standard one Postgres takes.
    # This said INDEX unconditionally, and the failure was swallowed at info level — so on the
    # Postgres server the old constraint was never dropped, silently, and the merge died with a
    # duplicate key on every attempt while passing every test against MySQL here. The docstring
    # above predicted exactly this failure; the statement underneath it did not match.
    drop_sql = _drop_unique_sql(engine.dialect.name, "customer_account", "{name}")

    for uc in constraints:
        # Only the one that pins a customer to a single account. A UNIQUE that already spans
        # (customer_id, family) is the goal state and must survive.
        if uc.get("column_names") == ["customer_id"]:
            try:
                with engine.begin() as conn:
                    conn.execute(text(drop_sql.format(name=uc["name"])))
                log.info("dropped single-account constraint %s", uc["name"])
            except Exception as exc:
                # WARNING, not info. This one is load-bearing: with it in place a customer cannot
                # hold two accounts, which is the whole point of the merge — and a note nobody
                # reads is how it stayed broken.
                log.warning(
                    "could not drop single-account constraint %s (%s): a customer cannot hold "
                    "two receivable accounts until it is gone, so the merge will fail",
                    uc["name"], exc)

    if "uq_customer_account_family" not in names:
        try:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE customer_account "
                    "ADD CONSTRAINT uq_customer_account_family UNIQUE (customer_id, family)"))
        except Exception as exc:  # pragma: no cover
            log.info("add uq_customer_account_family skipped: %s", exc)


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
