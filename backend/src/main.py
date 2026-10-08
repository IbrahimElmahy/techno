from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

import src.models.coupon_issue  # noqa: F401
import src.services.loyalty_hooks  # noqa: F401
from src.api import (
    accounting,
    admin,
    drafts,
    advances,
    after_sales_reports,
    app_update,
    attachments,
    document_attachments,
    a5_sync,
    attendance,
    audit,
    auth,
    branch_overview,
    owner_stats,
    catalog,
    cheques,
    income_statement,
    cost_centers,
    coupon_custody,
    coupon_receipts,
    coupons,
    customers,
    employees,
    fixed_assets,
    hr,
    hr_reports,
    inspections,
    leave,
    live,
    loyalty_settings,
    manufacturing,
    ops_reports,
    orders,
    org,
    owners,
    insurance,
    payroll_setup,
    payroll_sheet,
    permissions,
    points,
    price_display,
    product_points,
    purchases,
    reconciliation,
    rep_reports,
    reports,
    reps,
    reservations,
    sales,
    serials,
    settings_lookups,
    stock,
    stock_counts,
    suppliers,
    supervisor,
    partners_current,
    party_links,
    tax_commissions,
    transfers,
    treasury,
    users,
    voucher_keys,
    vouchers,
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

    from src.core.config import settings as _settings

    from src.core.request_audit import RequestAuditMiddleware

    from src.core.document_versions import DocumentVersionMiddleware

    app.add_middleware(DocumentVersionMiddleware)
    app.add_middleware(RequestAuditMiddleware)

    from src.lib.live_events import LiveEventsMiddleware

    app.add_middleware(LiveEventsMiddleware)

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
        allow_origin_regex=r"https://(.*\.)?technothermeg\.com",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def _security_headers(request, call_next):  # pragma: no cover
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response

    from src.auth import branch_scope as _branch_scope

    @app.middleware("http")
    async def _view_branch(request, call_next):
        raw = request.headers.get("x-view-branch")
        token = _branch_scope.set_view_branch(int(raw) if raw and raw.isdigit() else None)
        try:
            return await call_next(request)
        finally:
            _branch_scope.reset_view_branch(token)

    import logging as _logging
    import time as _time

    _slow_log = _logging.getLogger("uvicorn.error")

    @app.middleware("http")
    async def _slow_requests(request, call_next):
        t0 = _time.perf_counter()
        response = await call_next(request)
        ms = (_time.perf_counter() - t0) * 1000
        if ms >= 1000:
            q = request.url.query
            _slow_log.warning("SLOW %d %s %s%s", ms, request.method, request.url.path,
                              f"?{q[:200]}" if q else "")
        return response

    prefix = "/api/v1"
    app.include_router(auth.router, prefix=prefix)
    app.include_router(users.router, prefix=prefix)
    app.include_router(org.router, prefix=prefix)
    app.include_router(warehouses.router, prefix=prefix)
    app.include_router(treasury.router, prefix=prefix)
    app.include_router(customers.router, prefix=prefix)
    app.include_router(audit.router, prefix=prefix)
    from src.api import document_versions as _document_versions
    app.include_router(_document_versions.router, prefix=prefix)
    app.include_router(permissions.router, prefix=prefix)
    app.include_router(branch_overview.router, prefix=prefix)
    app.include_router(owner_stats.router, prefix=prefix)
    app.include_router(reps.router, prefix=prefix)
    app.include_router(supervisor.router, prefix=prefix)
    app.include_router(partners_current.router, prefix=prefix)
    app.include_router(party_links.router, prefix=prefix)
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
    app.include_router(product_points.router, prefix=prefix)
    app.include_router(loyalty_settings.router, prefix=prefix)
    app.include_router(points.router, prefix=prefix)
    app.include_router(points.ledger_router, prefix=prefix)
    app.include_router(coupons.router, prefix=prefix)
    app.include_router(reports.router, prefix=prefix)
    app.include_router(voucher_keys.router, prefix=prefix)
    app.include_router(accounting.router, prefix=prefix)
    app.include_router(reconciliation.router, prefix=prefix)
    app.include_router(cost_centers.router, prefix=prefix)
    app.include_router(settings_lookups.router, prefix=prefix)
    app.include_router(wastage.router, prefix=prefix)
    from src.api import fleet as _fleet
    app.include_router(_fleet.router, prefix=prefix)
    app.include_router(inspections.router, prefix=prefix)
    app.include_router(owners.router, prefix=prefix)
    app.include_router(vouchers.router, prefix=prefix)
    app.include_router(cheques.router, prefix=prefix)
    app.include_router(income_statement.router, prefix=prefix)
    app.include_router(tax_commissions.router, prefix=prefix)
    app.include_router(fixed_assets.router, prefix=prefix)
    app.include_router(employees.router, prefix=prefix)
    app.include_router(hr.router, prefix=prefix)
    app.include_router(attendance.router, prefix=prefix)
    app.include_router(leave.router, prefix=prefix)
    app.include_router(payroll_setup.router, prefix=prefix)
    app.include_router(advances.router, prefix=prefix)
    app.include_router(insurance.router, prefix=prefix)
    app.include_router(payroll_sheet.router, prefix=prefix)
    app.include_router(hr_reports.router, prefix=prefix)
    from src.api import hr_commissions as _hr_commissions
    app.include_router(_hr_commissions.router, prefix=prefix)
    app.include_router(ops_reports.router, prefix=prefix)
    app.include_router(orders.router, prefix=prefix)
    app.include_router(coupon_receipts.router, prefix=prefix)
    app.include_router(coupon_custody.router, prefix=prefix)
    app.include_router(after_sales_reports.router, prefix=prefix)
    app.include_router(attachments.router, prefix=prefix)
    app.include_router(document_attachments.router, prefix=prefix)
    app.include_router(a5_sync.router, prefix=prefix)
    app.include_router(drafts.router, prefix=prefix)
    app.include_router(admin.router, prefix=prefix)
    app.include_router(live.router, prefix=prefix)
    app.include_router(app_update.router, prefix=prefix)
    from src.api import period_closing as _period_closing
    app.include_router(_period_closing.router, prefix=prefix)

    @app.get("/health")
    def health() -> dict:
        import os

        sha = (os.getenv("VERCEL_GIT_COMMIT_SHA") or os.getenv("RENDER_GIT_COMMIT")
               or os.getenv("GIT_COMMIT") or "")
        return {
            "status": "ok",
            "commit": sha[:7] if sha else "unknown",
            "routes": len(app.openapi().get("paths", {})),
        }

    try:
        import src.models  # noqa: F401
        from src.core.db import Base, engine

        Base.metadata.create_all(engine)
        _ensure_columns(engine)
        _ensure_indexes(engine)
        _sync_constraints(engine)
        _relax_not_null(engine)
        _widen_columns(engine)
        _ensure_customer_account_family(engine)
        _relax_configurable_enum_columns(engine)
        _backfill_branch(engine)
        _migrate_appears_in(engine)
        _ensure_coupon_kind_tiers(engine)
        _seed_journals(engine)
        _mark_reconcilable_accounts(engine)
        _move_insurance_component(engine)
        _load_permission_overrides()
    except Exception as exc:  # pragma: no cover
        import logging

        logging.getLogger("uvicorn.error").warning("startup schema sync skipped: %s", exc)

    app.add_middleware(GZipMiddleware, minimum_size=1024)

    _mount_frontend(app)
    return app


def _mount_frontend(app: FastAPI) -> None:
    from pathlib import Path

    dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if not (dist / "index.html").exists():
        return

    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    class _Assets(StaticFiles):
        def file_response(self, *args, **kwargs):
            resp = super().file_response(*args, **kwargs)
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return resp

    app.mount("/assets", _Assets(directory=dist / "assets"), name="assets")

    NO_STORE = {"Cache-Control": "no-store, must-revalidate"}
    FOREVER = {"Cache-Control": "public, max-age=31536000, immutable"}

    @app.get("/{full_path:path}", include_in_schema=False)
    def _spa(full_path: str):
        candidate = dist / full_path
        if full_path and candidate.is_file():
            fingerprinted = candidate.parent.name == "assets"
            return FileResponse(candidate, headers=FOREVER if fingerprinted else NO_STORE)
        return FileResponse(dist / "index.html", headers=NO_STORE)


def _load_permission_overrides() -> None:
    from src.auth import rbac
    from src.core.db import SessionLocal

    db = SessionLocal()
    try:
        rbac.refresh_overrides(db)
    finally:
        db.close()


_ADDED_INDEXES: list[tuple[str, str, str]] = [
    ("ix_point_record_inspection_id", "point_record", "inspection_id"),
    ("ix_point_record_purse", "point_record", "purse"),
    ("ix_ledger_line_partner", "ledger_line", "partner_kind, partner_id"),
    ("ix_ledger_entry_partner", "ledger_entry", "partner_kind, partner_id"),
    ("ix_ledger_entry_move_type", "ledger_entry", "move_type"),
    ("ix_ledger_entry_journal_id", "ledger_entry", "journal_id"),
    ("ix_ledger_entry_state", "ledger_entry", "state"),
    ("ix_ledger_line_residual", "ledger_line", "amount_residual"),
    ("ix_ledger_line_full_reconcile", "ledger_line", "full_reconcile_id"),
    ("ix_stock_movement_location", "stock_movement", "location_kind, location_id"),
]


_ADDED_COLUMNS: list[tuple[str, str, str]] = [
    ("bom_component", "stage", "VARCHAR(16)"),
    ("production_order_material", "stage", "VARCHAR(16)"),
    ("production_order_product", "received_quantity", "DECIMAL(18,3) NOT NULL DEFAULT 0"),
    ("employee", "receivable_account_id", "BIGINT"),
    ("owner", "phone2", "VARCHAR(32)"),
    ("sales_invoice", "prior_balance", "DECIMAL(18,2)"),
    ("sales_invoice", "other_family_balance", "DECIMAL(18,2)"),
    ("sales_invoice", "other_family", "VARCHAR(16)"),
    ("stock_movement", "movement_date", "DATE"),
    ("user", "session_id", "VARCHAR(64)"),
    ("user", "session_client", "VARCHAR(16)"),
    ("user", "session_started_at", "TIMESTAMP"),
    ("user", "supervisor_id", "BIGINT"),
    ("purchase_return", "expense_account_id", "BIGINT"),
    ("purchase_return", "external_document_number", "VARCHAR(40)"),
    ("purchase_return", "statement1", "VARCHAR(200)"),
    ("purchase_return", "statement2", "VARCHAR(200)"),
    ("purchase_return", "statement3", "VARCHAR(200)"),
    ("purchase_return", "gross", "DECIMAL(18,2)"),
    ("purchase_return", "variable_discount_pct", "DECIMAL(9,4)"),
    ("purchase_return", "combined_pct", "DECIMAL(9,4)"),
    ("coupon_receipt_line", "coupon_type_id", "BIGINT"),
    ("coupon_receipt_line", "coupon_kind", "VARCHAR(24)"),
    ("coupon_receipt_line", "coupon_issue_id", "BIGINT"),
    ("customer", "service_rep_id", "BIGINT"),
    ("customer", "supplier_id", "BIGINT"),
    ("branch", "is_factory", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("lookup_option", "parent_value", "VARCHAR(64)"),
    ("point_record", "inspection_id", "BIGINT"),
    ("point_record", "purse", "VARCHAR(16)"),
    ("accounting_setting", "payment_terms_days", "INTEGER NOT NULL DEFAULT 0"),
    ("inspection", "merchant_customer_id", "BIGINT"),
    ("inspection", "owner_id", "BIGINT"),
    ("owner", "governorate_id", "BIGINT"),
    ("owner", "markaz", "VARCHAR(120)"),
    ("sales_invoice_coupon", "coupon_kind", "VARCHAR(24)"),
    ("ledger_entry", "external_ref", "VARCHAR(60)"),
    ("ledger_entry", "journal_id", "BIGINT"),
    ("ledger_entry", "state", "VARCHAR(12)"),
    ("ledger_entry", "number", "VARCHAR(32)"),
    ("ledger_entry", "posted_at", "TIMESTAMP"),
    ("ledger_entry", "move_type", "VARCHAR(16)"),
    ("ledger_entry", "partner_kind", "VARCHAR(12)"),
    ("ledger_entry", "partner_id", "BIGINT"),
    ("ledger_entry", "invoice_date_due", "DATE"),
    ("ledger_entry", "payment_state", "VARCHAR(16)"),
    ("voucher", "cost_center_id", "BIGINT"),
    ("sales_invoice", "cost_center_id", "BIGINT"),
    ("sales_return", "cost_center_id", "BIGINT"),
    ("purchase_invoice", "cost_center_id", "BIGINT"),
    ("purchase_return", "cost_center_id", "BIGINT"),
    ("ledger_entry", "secure_sequence_number", "BIGINT"),
    ("ledger_entry", "inalterable_hash", "VARCHAR(64)"),
    ("journal", "restrict_mode_hash", "BOOLEAN"),
    ("ledger_line", "partner_kind", "VARCHAR(12)"),
    ("ledger_line", "partner_id", "BIGINT"),
    ("ledger_line", "date_maturity", "DATE"),
    ("ledger_line", "amount_residual", "DECIMAL(18,2)"),
    ("ledger_line", "full_reconcile_id", "BIGINT"),
    ("account", "reconcilable", "BOOLEAN DEFAULT FALSE"),
    ("sales_invoice", "client_uuid", "VARCHAR(64)"),
    ("sales_invoice", "is_bonus", "BOOLEAN"),
    ("sales_invoice", "bonus_for_invoice_id", "BIGINT"),
    ("voucher", "client_uuid", "VARCHAR(64)"),
    ("stock_transfer", "client_uuid", "VARCHAR(64)"),
    ("sales_return", "reversed_at", "DATETIME"),
    ("sales_return", "reversal_entry_id", "BIGINT"),
    ("trade_order", "gross", "DECIMAL(18,2)"),
    ("trade_order", "variable_discount_pct", "DECIMAL(18,2)"),
    ("trade_order_line", "unit", "VARCHAR(16)"),
    ("trade_order_line", "unit_factor", "DECIMAL(18,9)"),
    ("trade_order_line", "discount_pct", "DECIMAL(18,2)"),
    ("purchase_return_line", "discount_pct", "DECIMAL(9,4)"),
    ("purchase_return_line", "unit", "VARCHAR(16)"),
    ("purchase_return_line", "unit_factor", "DECIMAL(18,9)"),
    ("purchase_return_line", "line_location_kind", "VARCHAR(20)"),
    ("purchase_return_line", "line_location_id", "BIGINT"),
    ("purchase_return", "supplier_id", "BIGINT"),
    ("purchase_return", "origin_location_kind", "VARCHAR(20)"),
    ("purchase_return", "origin_location_id", "BIGINT"),
    ("purchase_return_line", "unit_price", "DECIMAL(18,2)"),
    ("purchase_return_line", "line_total", "DECIMAL(18,2)"),
    ("purchase_return", "reversed_at", "DATETIME"),
    ("purchase_return", "reversal_entry_id", "BIGINT"),
    ("employee", "department_id", "BIGINT"),
    ("inspection", "purchase_shop_phone", "VARCHAR(40)"),
    ("purchase_invoice", "gross", "DECIMAL(18,2)"),
    ("purchase_invoice", "fixed_discount_pct", "DECIMAL(9,4)"),
    ("purchase_invoice", "variable_discount_pct", "DECIMAL(9,4)"),
    ("purchase_invoice", "combined_pct", "DECIMAL(9,4)"),
    ("purchase_invoice", "net", "DECIMAL(18,2)"),
    ("purchase_invoice", "tax_amount", "DECIMAL(18,2)"),
    ("purchase_invoice_line", "discount_pct", "DECIMAL(9,4)"),
    ("coupon_receipt", "declared_kind", "VARCHAR(24)"),
    ("coupon_receipt", "declared_value", "DECIMAL(18,2)"),
    ("coupon_receipt", "customer_type", "VARCHAR(16)"),
    ("voucher_key", "debit_group", "VARCHAR(40)"),
    ("voucher_key", "credit_group", "VARCHAR(40)"),
    ("sales_return", "return_date", "DATE"),
    ("purchase_invoice", "purchase_date", "DATE"),
    ("purchase_return", "return_date", "DATE"),
    ("customer_account", "family", "VARCHAR(40)"),
    ("customer_account", "commission_pct", "DECIMAL(9,4)"),
    ("sales_invoice", "family", "VARCHAR(40)"),
    ("sales_return", "family", "VARCHAR(40)"),
    ("stock_permit_line", "expiry_date", "DATE"),
    ("voucher", "family", "VARCHAR(40)"),
    ("customer", "default_return_warehouse_id", "BIGINT"),
    ("stock_transfer", "reject_reason", "VARCHAR(240)"),
    ("stock_transfer", "transfer_date", "DATE"),
    ("sales_invoice", "branch_id", "BIGINT"),
    ("sales_return", "branch_id", "BIGINT"),
    ("purchase_invoice", "branch_id", "BIGINT"),
    ("purchase_return", "branch_id", "BIGINT"),
    ("stock_movement", "branch_id", "BIGINT"),
    ("voucher", "branch_id", "BIGINT"),
    ("coupon_receipt", "branch_id", "BIGINT"),
    ("inspection", "branch_id", "BIGINT"),
    ("stock_transfer", "branch_id", "BIGINT"),
    ("territory", "parent_id", "BIGINT"),
    ("stock_count", "kind", "VARCHAR(16) NOT NULL DEFAULT 'full'"),
    ("purchase_return", "notes", "VARCHAR(500)"),
    ("customer", "branch_id", "BIGINT"),
    ("customer", "email", "VARCHAR(160)"),
    ("customer", "employee_id", "BIGINT"),
    ("customer", "tax_number", "VARCHAR(40)"),
    ("customer", "commercial_register", "VARCHAR(40)"),
    ("customer", "discount_pct", "DECIMAL(5,2)"),
    ("customer", "vat_pct", "DECIMAL(5,2)"),
    ("customer", "is_cash", "BOOLEAN DEFAULT FALSE NOT NULL"),
    ("branch", "note1", "VARCHAR(300)"),
    ("branch", "note2", "VARCHAR(300)"),
    ("supplier", "supplier_type", "VARCHAR(32)"),
    ("supplier", "email", "VARCHAR(160)"),
    ("supplier", "tax_number", "VARCHAR(40)"),
    ("supplier", "commercial_register", "VARCHAR(40)"),
    ("supplier", "is_cash", "BOOLEAN DEFAULT FALSE NOT NULL"),
    ("employee", "address", "VARCHAR(240)"),
    ("employee", "work_start", "VARCHAR(20)"),
    ("employee", "work_end", "VARCHAR(20)"),
    ("employee", "collection_commission_pct", "DECIMAL(5,2)"),
    ("sales_setting", "edit_lock_days", "INT"),
    ("manufacturing_order", "production_date", "DATE"),
    ("manufacturing_order", "branch_id", "BIGINT"),
    ("manufacturing_order", "work_order_ref", "VARCHAR(60)"),
    ("manufacturing_order", "notes", "VARCHAR(500)"),
    ("bom_component", "unit", "VARCHAR(16)"),
    ("bom_component", "unit_factor", "DECIMAL(18,9) NOT NULL DEFAULT 1"),
    ("account", "main_level", "VARCHAR(80)"),
    ("supplier", "branch_id", "BIGINT"),
    ("supplier", "governorate_id", "BIGINT"),
    ("supplier", "markaz", "VARCHAR(120)"),
    ("warehouse", "description", "VARCHAR(300)"),
    ("employee", "warehouse_id", "BIGINT"),
    ("item", "piece_name", "VARCHAR(32)"),
    ("item", "pieces_per_unit", "DECIMAL(18,3)"),
    ("item", "description", "VARCHAR(500)"),
    ("item_price", "discount_pct", "DECIMAL(5,2)"),
    ("item_price", "vat_pct", "DECIMAL(5,2)"),
    ("lookup_option", "description", "VARCHAR(300)"),
    ("lookup_option", "hidden_in_price_sheet", "BOOLEAN"),
    ("sales_invoice", "expenses_billed", "DECIMAL(18,2)"),
    ("sales_invoice", "expenses_operating", "DECIMAL(18,2)"),
    ("sales_invoice", "invoice_date", "DATE"),
    ("sales_invoice", "coupon_serial_from", "VARCHAR(24)"),
    ("sales_invoice", "coupon_serial_to", "VARCHAR(24)"),
    ("sales_invoice", "coupon_count", "INTEGER"),
    ("account", "appears_in", "VARCHAR(24)"),
    ("item", "default_warehouse_id", "BIGINT"),
    ("sales_invoice_line", "discount_pct", "NUMERIC(5,2) NOT NULL DEFAULT 0"),
    ("sales_invoice_line", "fixed_discount_pct", "NUMERIC(5,2)"),
    ("sales_invoice_line", "variable_discount_pct", "NUMERIC(5,2)"),
    ("purchase_invoice_line", "fixed_discount_pct", "NUMERIC(5,2)"),
    ("purchase_invoice_line", "variable_discount_pct", "NUMERIC(5,2)"),
    ("purchase_return_line", "fixed_discount_pct", "NUMERIC(5,2)"),
    ("purchase_return_line", "variable_discount_pct", "NUMERIC(5,2)"),
    ("sales_return_line", "fixed_discount_pct", "NUMERIC(5,2)"),
    ("sales_return_line", "variable_discount_pct", "NUMERIC(5,2)"),
    ("manufacturing_order", "material_cost", "NUMERIC(18,2) NOT NULL DEFAULT 0"),
    ("manufacturing_order", "resource_cost", "NUMERIC(18,2) NOT NULL DEFAULT 0"),
    ("manufacturing_order_consumption", "waste_quantity", "NUMERIC(18,3) NOT NULL DEFAULT 0"),
    ("manufacturing_order_consumption", "warehouse_id", "BIGINT"),
    ("item", "category", "VARCHAR(80)"),
    ("supplier", "address", "VARCHAR(240)"),
    ("customer", "governorate_id", "BIGINT"),
    ("customer", "markaz", "VARCHAR(120)"),
    ("customer", "address", "VARCHAR(240)"),
    ("item", "default_discount_pct", "NUMERIC(5,2) NOT NULL DEFAULT 0"),
    ("account", "branch_id", "BIGINT"),
    ("inspection_item", "stock_movement_id", "BIGINT"),
    ("inspection", "customer_id", "BIGINT"),
    ("sales_setting", "vat_rate_pct", "NUMERIC(5,2) NOT NULL DEFAULT 0"),
    ("sales_setting", "purchase_poly_discount_pct", "NUMERIC(5,2) NOT NULL DEFAULT 52.5"),
    ("sales_setting", "purchase_white_discount_pct", "NUMERIC(5,2) NOT NULL DEFAULT 34.5"),
    ("sales_invoice", "tax_amount", "NUMERIC(18,2) NOT NULL DEFAULT 0"),
    ("voucher", "treasury_id", "BIGINT"),
    ("voucher", "to_treasury_id", "BIGINT"),
    ("inspection", "certificate_number", "BIGINT"),
    ("inspection", "visit_type", "VARCHAR(40) NOT NULL DEFAULT 'معاينة'"),
    ("inspection", "status", "VARCHAR(12) NOT NULL DEFAULT 'accepted'"),
    ("inspection", "printed", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("inspection", "printed_at", "TIMESTAMP"),
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
    ("sales_return_line", "unit_factor", "NUMERIC(18,9) NOT NULL DEFAULT 1"),
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
    ("item", "min_stock", "NUMERIC(18,3)"),
    ("item", "max_stock", "NUMERIC(18,3)"),
    ("item", "is_perishable", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("stock_transfer", "statement1", "VARCHAR(200)"),
    ("stock_transfer", "notes", "VARCHAR(500)"),
    ("stock_permit", "statement1", "VARCHAR(200)"),
    ("voucher", "statement1", "VARCHAR(200)"),
    ("stock_transfer", "external_document_number", "VARCHAR(40)"),
    ("stock_permit", "external_document_number", "VARCHAR(40)"),
    ("voucher", "external_document_number", "VARCHAR(40)"),
    ("custody", "family", "VARCHAR(24)"),
    ("cheque", "statement1", "VARCHAR(200)"),
    ("manufacturing_order", "statement1", "VARCHAR(200)"),
    ("wastage_document", "statement1", "VARCHAR(200)"),
    ("stock_count", "statement1", "VARCHAR(200)"),
    ("trade_order", "statement1", "VARCHAR(200)"),
    ("coupon_receipt", "status", "VARCHAR(16)"),
    ("coupon_receipt", "approved_by", "BIGINT"),
    ("coupon_receipt", "approved_at", "TIMESTAMP"),
    ("coupon_receipt", "reject_reason", "VARCHAR(240)"),
    ("coupon_receipt", "rejected_serials", "TEXT"),
    ("coupon_receipt", "source", "VARCHAR(8)"),
]

_WIDENED_COLUMNS: list[tuple[str, str, str]] = [
    ("item_price", "tier",
     "ENUM('commercial','semi_commercial','wholesale','semi_wholesale','consumer','list_price')"),
    ("product_point_value", "point_value", "NUMERIC(18,3)"),
    ("point_record", "delta", "NUMERIC(18,3)"),
    ("stock_transfer", "route",
     "ENUM('central_to_branch','central_to_rep','rep_to_rep','rep_to_central')"),
    ("production_order", "state",
     "ENUM('draft','confirmed','in_progress','done','reversed')"),
    ("point_record", "kind",
     "ENUM('earn','reverse','converted','void_reclaim','adjustment','inspection',"
     "'inspection_reverse')"),
    ("role", "name",
     "ENUM('system_admin','branch_manager','purchasing_manager','sales_manager',"
     "'after_sales_staff','sales_rep','accountant','viewer','owner','rep_supervisor')"),
    ("role_capability", "role",
     "ENUM('system_admin','branch_manager','purchasing_manager','sales_manager',"
     "'after_sales_staff','sales_rep','accountant','viewer','owner','rep_supervisor')"),
    ("item_unit", "factor", "NUMERIC(18,9)"),
    ("sales_invoice_line", "unit_factor", "NUMERIC(18,9)"),
    ("sales_return_line", "unit_factor", "NUMERIC(18,9)"),
    ("purchase_invoice_line", "unit_factor", "NUMERIC(18,9)"),
    ("purchase_return_line", "unit_factor", "NUMERIC(18,9)"),
    ("trade_order_line", "unit_factor", "NUMERIC(18,9)"),
    ("bom_component", "unit_factor", "NUMERIC(18,9)"),
    ("production_order_product", "unit_factor", "NUMERIC(18,9)"),
    ("production_order_material", "unit_factor", "NUMERIC(18,9)"),
]


_DROPPED_CONSTRAINTS: list[tuple[str, str]] = [
    ("coupon_receipt_line", "uq_coupon_receipt_serial"),
    ("coupon_receipt_line", "uq_coupon_receipt_type_serial"),
    ("custody", "uq_custody_rep"),
]


_ADDED_CONSTRAINTS: list[tuple[str, str, tuple[str, ...]]] = [
    ("coupon_receipt_line", "uq_coupon_receipt_kind_serial",
     ("coupon_kind", "serial")),
    ("custody", "uq_custody_rep_family", ("rep_id", "family")),
    ("stock_transfer", "uq_stock_transfer_client_uuid", ("client_uuid",)),
]


def _sync_constraints(engine) -> None:
    import logging

    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    log = logging.getLogger("uvicorn.error")
    inspector = sa_inspect(engine)
    existing_tables = set(inspector.get_table_names())
    for table, name in _DROPPED_CONSTRAINTS:
        if table not in existing_tables:
            continue
        have = {u["name"] for u in inspector.get_unique_constraints(table)}
        have |= {i["name"] for i in inspector.get_indexes(table)}
        if name not in have:
            continue
        errors = []
        for ddl in (f"ALTER TABLE {table} DROP CONSTRAINT {name}",
                    f"ALTER TABLE `{table}` DROP INDEX `{name}`",
                    f"DROP INDEX {name}"):
            try:
                with engine.begin() as conn:
                    conn.execute(text(ddl))
                break
            except Exception as exc:
                errors.append(str(exc)[:120])
        else:
            log.warning("drop constraint %s.%s failed: %s", table, name, errors)

    for table, name, cols in _ADDED_CONSTRAINTS:
        if table not in existing_tables:
            continue
        have = {u["name"] for u in inspector.get_unique_constraints(table)}
        have |= {i["name"] for i in inspector.get_indexes(table)}
        if name in have:
            continue
        joined = ", ".join(cols)
        try:
            with engine.begin() as conn:
                conn.execute(text(
                    f"ALTER TABLE {table} ADD CONSTRAINT {name} UNIQUE ({joined})"))
        except Exception as exc:
            log.warning("add constraint %s.%s failed: %s", table, name, str(exc)[:160])


def _enum_labels(ddl_type: str) -> list[str] | None:
    import re

    m = re.match(r"^\s*ENUM\s*\((.*)\)\s*$", ddl_type, re.IGNORECASE | re.DOTALL)
    if not m:
        return None
    return [p.strip().strip("'") for p in m.group(1).split(",") if p.strip()]


def _widen_pg_enum(engine, table: str, column: str, labels: list[str]) -> None:
    from sqlalchemy import text

    with engine.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        udt = conn.execute(text(
            "SELECT udt_name FROM information_schema.columns "
            "WHERE table_name = :t AND column_name = :c AND data_type = 'USER-DEFINED'"
        ), {"t": table, "c": column}).scalar()
        if not udt:
            return
        for label in labels:
            conn.execute(text(
                f'ALTER TYPE "{udt}" ADD VALUE IF NOT EXISTS \'{label}\''))


def _widen_columns(engine) -> None:
    import logging
    import re

    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    dialect = engine.dialect.name
    if dialect not in ("postgresql", "postgres", "mysql", "mariadb"):
        return
    inspector = sa_inspect(engine)
    tables = set(inspector.get_table_names())
    for table, column, ddl_type in _WIDENED_COLUMNS:
        if table not in tables:
            continue
        col = next((c for c in inspector.get_columns(table) if c["name"] == column), None)
        if col is None:
            continue
        labels = _enum_labels(ddl_type)
        try:
            if labels is not None:
                if dialect in ("postgresql", "postgres"):
                    _widen_pg_enum(engine, table, column, labels)
                else:
                    with engine.begin() as conn:
                        conn.execute(text(
                            f"ALTER TABLE `{table}` MODIFY `{column}` {ddl_type} NOT NULL"))
                continue
            current = str(col["type"]).upper()
            if "NUMERIC" in current or "DECIMAL" in current:
                want = re.search(r"\(\s*(\d+)\s*,\s*(\d+)\s*\)", ddl_type)
                have_scale = getattr(col["type"], "scale", None)
                if want is None or have_scale is None or have_scale >= int(want.group(2)):
                    continue
            null_sql = "NULL" if col.get("nullable", False) else "NOT NULL"
            default = col.get("default")
            default_sql = f" DEFAULT {default}" if default not in (None, "") else ""
            with engine.begin() as conn:
                if dialect in ("postgresql", "postgres"):
                    conn.execute(text(
                        f'ALTER TABLE {table} ALTER COLUMN {column} TYPE {ddl_type} '
                        f'USING {column}::numeric'))
                else:
                    conn.execute(text(
                        f"ALTER TABLE `{table}` MODIFY `{column}` {ddl_type} {null_sql}{default_sql}"))
        except Exception as exc:  # pragma: no cover
            logging.getLogger("uvicorn.error").info(
                "widen %s.%s skipped: %s", table, column, exc)


_NULLABLE_FK_COLUMNS: list[tuple[str, str]] = [
    ("purchase_invoice", "ledger_entry_id"),
    ("purchase_return", "ledger_entry_id"),
    ("sales_invoice", "ledger_entry_id"),
    ("sales_return", "ledger_entry_id"),
    ("manufacturing_op", "stock_movement_id"),
    ("manufacturing_order", "stock_movement_id"),
    ("manufacturing_order_consumption", "stock_movement_id"),
    ("wastage_document", "stock_movement_id"),
    ("sales_return", "sales_invoice_id"),
    ("coupon_receipt_line", "sales_invoice_id"),
    ("customer", "rep_id"),
]


def _relax_not_null(engine) -> None:
    import logging

    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    dialect = engine.dialect.name
    if dialect not in ("postgresql", "postgres", "mysql", "mariadb"):
        return
    inspector = sa_inspect(engine)
    tables = set(inspector.get_table_names())
    for table, column in _NULLABLE_FK_COLUMNS:
        if table not in tables:
            continue
        col = next((c for c in inspector.get_columns(table) if c["name"] == column), None)
        if col is None or col.get("nullable", True):
            continue
        try:
            with engine.begin() as conn:
                if dialect in ("postgresql", "postgres"):
                    conn.execute(text(f'ALTER TABLE {table} ALTER COLUMN {column} DROP NOT NULL'))
                else:
                    conn.execute(text(f"ALTER TABLE `{table}` MODIFY `{column}` BIGINT NULL"))
        except Exception as exc:  # pragma: no cover
            logging.getLogger("uvicorn.error").info(
                "relax not-null %s.%s skipped: %s", table, column, exc
            )


def _backfill_branch(engine) -> None:
    import logging

    from sqlalchemy import func, select, update
    from sqlalchemy import inspect as sa_inspect

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
    except Exception as exc:  # pragma: no cover
        db.rollback()
        logging.getLogger("uvicorn.error").info("branch backfill skipped: %s", exc)
    finally:
        db.close()


def _migrate_appears_in(engine) -> None:
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
    except Exception as exc:  # pragma: no cover
        logging.getLogger("uvicorn.error").info("appears_in migration skipped: %s", exc)


def _ensure_columns(engine) -> None:
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
        quote = engine.dialect.identifier_preparer.quote
        try:
            with engine.begin() as conn:
                conn.execute(
                    text(f"ALTER TABLE {quote(table)} ADD COLUMN {quote(column)} {ddl}")
                )
        except Exception as exc:  # pragma: no cover
            logging.getLogger("uvicorn.error").info(
                "ensure column %s.%s skipped: %s", table, column, exc
            )


def _mark_reconcilable_accounts(engine) -> None:
    import logging

    from sqlalchemy import text

    try:
        with engine.begin() as conn:
            conn.execute(text(
                "UPDATE account SET reconcilable = TRUE "
                "WHERE account_type IN ('customer_receivable', 'supplier_payable') "
                "AND (reconcilable IS NULL OR reconcilable = FALSE)"))
    except Exception as exc:  # pragma: no cover
        logging.getLogger("uvicorn.error").info("reconcilable sync skipped: %s", exc)


def _seed_journals(engine) -> None:
    import logging

    from sqlalchemy.orm import Session

    from src.services import journal_registry

    try:
        with Session(engine) as db:
            journal_registry.ensure_seeded(db)
            db.commit()
    except Exception as exc:  # pragma: no cover
        logging.getLogger("uvicorn.error").info("seed journals skipped: %s", exc)


def _ensure_indexes(engine) -> None:
    import logging

    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    inspector = sa_inspect(engine)
    existing_tables = set(inspector.get_table_names())
    for name, table, columns in _ADDED_INDEXES:
        if table not in existing_tables:
            continue
        have = {i["name"] for i in inspector.get_indexes(table)}
        if name in have:
            continue
        cols = {c["name"] for c in inspector.get_columns(table)}
        if any(c.strip() not in cols for c in columns.split(",")):
            continue
        try:
            with engine.begin() as conn:
                conn.execute(text(
                    f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({columns})"))
        except Exception as exc:  # pragma: no cover
            logging.getLogger("uvicorn.error").info(
                "ensure index %s on %s skipped: %s", name, table, exc
            )


def _drop_unique_sql(dialect: str, table: str, name: str) -> str:
    if dialect.startswith("postgres"):
        return f"ALTER TABLE {table} DROP CONSTRAINT {name}"
    return f"ALTER TABLE {table} DROP INDEX {name}"


def _ensure_customer_account_family(engine) -> None:
    import logging

    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    log = logging.getLogger("uvicorn.error")
    inspector = sa_inspect(engine)
    if "customer_account" not in set(inspector.get_table_names()):
        return
    try:
        constraints = inspector.get_unique_constraints("customer_account")
    except Exception as exc:  # pragma: no cover
        log.info("customer_account constraints unreadable: %s", exc)
        return

    names = {c["name"] for c in constraints}
    drop_sql = _drop_unique_sql(engine.dialect.name, "customer_account", "{name}")

    for uc in constraints:
        if uc.get("column_names") == ["customer_id"]:
            try:
                with engine.begin() as conn:
                    conn.execute(text(drop_sql.format(name=uc["name"])))
                log.info("dropped single-account constraint %s", uc["name"])
            except Exception as exc:
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
    import logging

    from sqlalchemy import text

    dialect = engine.dialect.name
    if dialect not in ("postgresql", "postgres", "mysql", "mariadb"):
        return
    from sqlalchemy import inspect as sa_inspect

    targets = [("customer", "customer_type", 32), ("role", "name", 40)]
    inspector = sa_inspect(engine)
    for table, column, length in targets:
        try:
            col = next((c for c in inspector.get_columns(table) if c["name"] == column), None)
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
                else:
                    conn.execute(text(
                        f"ALTER TABLE `{table}` MODIFY `{column}` VARCHAR({length}) NOT NULL"
                    ))
        except Exception as exc:  # pragma: no cover
            logging.getLogger("uvicorn.error").info(
                "relax enum %s.%s skipped: %s", table, column, exc
            )


def _ensure_coupon_kind_tiers(engine) -> None:
    import logging

    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy import text

    try:
        inspector = sa_inspect(engine)
        if "lookup_option" not in set(inspector.get_table_names()):
            return
        with engine.begin() as conn:
            conn.execute(text(
                "DELETE FROM lookup_option "
                "WHERE category = 'coupon_kind' AND value IN ('money', 'gift')"
            ))
    except Exception as exc:  # pragma: no cover
        logging.getLogger("uvicorn.error").info(
            "coupon_kind tiers fixup skipped: %s", exc
        )


def _move_insurance_component(engine) -> None:
    import logging

    from sqlalchemy.orm import Session

    from src.services import insurance_service

    try:
        with Session(engine) as db:
            moved = insurance_service.move_legacy_component(db)
            db.commit()
        if moved:
            logging.getLogger("uvicorn.error").info(
                "moved %s insurance amounts from salary cards", moved)
    except Exception as exc:  # pragma: no cover
        logging.getLogger("uvicorn.error").info("insurance move skipped: %s", exc)


app = create_app()
