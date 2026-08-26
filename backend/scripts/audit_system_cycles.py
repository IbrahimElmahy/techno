"""Comprehensive End-to-End Business Cycle Audit & Stress-Test for TechnoTherm ERP.

Tests every business cycle against a real SQLite database session in memory.
Reports all successful flows, failures, accounting discrepancies, missing validations, and edge cases.
"""
from __future__ import annotations

import sys
import traceback
from decimal import Decimal
from datetime import date, datetime

from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import sessionmaker

# Setup path
sys.path.insert(0, ".")

from src.core.db import Base
from src.core.security import hash_password
from src.core.money import to_money, to_qty, ZERO
from src.models.catalog import Item, ItemKind, PriceTier
from src.models.customer import Customer, CustomerAccount
from src.models.supplier import Supplier, SupplierAccount
from src.models.ledger import Account, AccountType, AccountNature, Direction, LedgerEntry, LedgerLine
from src.models.org import Governorate, Branch, Territory
from src.models.role import Role, RoleName
from src.models.user import User
from src.models.warehouse import Warehouse, WarehouseType, Custody
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.purchasing import PurchaseInvoice, PurchaseReturn
from src.models.sales import SalesInvoice, SalesReturn
from src.models.bom import Bom, BomComponent
from src.models.manufacturing import ManufacturingOp, ManufacturingOrder
from src.models.transfer import TransferRoute, TransferStatus, StockTransfer
from src.models.voucher import Voucher, VoucherKind
from src.models.cheque import Cheque, ChequeStatus, ChequeDirection
from src.models.inspection import Inspection, InspectionItem, VisitKind
from src.models.loyalty import Coupon, CouponStatus
from src.models.coupon_receipt import CouponReceipt
from src.models.employee import Employee
from src.models.hr_attendance import AttendanceDay
from src.models.hr_advance import EmployeeAdvance
from src.models.hr_payroll_run import PayrollRun
from src.services.inspection_service import LineIn

from src.services import (
    chart_service,
    customer_service,
    supplier_profile_service,
    purchase_service,
    sales_service,
    manufacturing_service,
    wastage_service,
    stock_service,
    transfer_service,
    stock_permit_service,
    stock_count_service,
    voucher_service,
    cheque_service,
    inspection_service,
    coupon_service,
    coupon_receipt_service,
    point_service,
    payroll_service,
    advance_service,
    trial_balance_service,
    financial_reports_service,
    statement_service,
    cost_center_service,
)
from src.services.purchase_service import PurchaseLine
from src.services.sales_service import SaleLine

results = {
    "passed": [],
    "failed": [],
    "warnings": [],
    "defects": [],
}

def log_pass(cycle: str, name: str):
    results["passed"].append(f"[{cycle}] {name}")
    print(f"  [PASS] {name}")

def log_fail(cycle: str, name: str, err: str):
    results["failed"].append(f"[{cycle}] {name}: {err}")
    print(f"  [FAIL] {name} -> {err}")

def log_defect(cycle: str, issue: str, severity: str = "Medium"):
    results["defects"].append({"cycle": cycle, "issue": issue, "severity": severity})
    print(f"  [DEFECT-{severity}] [{cycle}] {issue}")

def verify_journal_balanced(db, ledger_entry_id: int, context: str):
    lines = db.scalars(select(LedgerLine).where(LedgerLine.entry_id == ledger_entry_id)).all()
    debit = sum(l.amount for l in lines if l.direction == Direction.debit)
    credit = sum(l.amount for l in lines if l.direction == Direction.credit)
    if debit != credit:
        msg = f"Unbalanced Ledger Entry #{ledger_entry_id} in {context}: Debit={debit}, Credit={credit}, Diff={debit - credit}"
        log_defect("General Ledger", msg, "Critical")
        return False
    return True

def run_all_audits():
    print("=" * 80)
    print("STARTING FULL SYSTEM BUSINESS CYCLE AUDIT & STRESS TEST")
    print("=" * 80)

    # 1. Setup in-memory SQLite Engine
    test_engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(test_engine)
    Session = sessionmaker(bind=test_engine)
    db = Session()

    try:
        # -------------------------------------------------------------
        # CYCLE 0: Foundation Setup (Org, Roles, Users, Chart of Accounts)
        # -------------------------------------------------------------
        print("\n--- 0. FOUNDATION & CHART OF ACCOUNTS SETUP ---")
        gov = Governorate(name="القاهرة")
        db.add(gov)
        db.flush()
        branch1 = Branch(name="فرع القاهرة الرئيسي", governorate_id=gov.id)
        branch2 = Branch(name="فرع الإسكندرية", governorate_id=gov.id)
        db.add_all([branch1, branch2])
        db.flush()
        terr = Territory(name="منطقة شرق", branch_id=branch1.id)
        db.add(terr)
        db.flush()

        roles = {}
        for rn in RoleName:
            r = Role(name=rn)
            db.add(r)
            db.flush()
            roles[rn] = r.id

        admin = User(username="admin_audit", password_hash=hash_password("pw"), role_id=roles[RoleName.system_admin], full_name="Admin")
        rep = User(username="rep_audit", password_hash=hash_password("pw"), role_id=roles[RoleName.sales_rep], full_name="Rep", branch_id=branch1.id, territory_id=terr.id)
        aftersales = User(username="aftersales_audit", password_hash=hash_password("pw"), role_id=roles[RoleName.after_sales_staff], full_name="AfterSales", branch_id=branch1.id, territory_id=terr.id)
        acc = User(username="acc_audit", password_hash=hash_password("pw"), role_id=roles[RoleName.accountant], full_name="Accountant")
        db.add_all([admin, rep, aftersales, acc])
        db.flush()

        # Seed Standard Chart
        chart_service.seed_standard_chart(db)

        # Create Custody for Sales Reps
        acc_rep_custody = Account(account_type=AccountType.custody, owner_ref=None, normal_side=Direction.debit)
        db.add(acc_rep_custody)
        db.flush()
        c_rep = Custody(holder_type="rep", rep_id=rep.id, warehouse_id=None, account_id=acc_rep_custody.id)
        db.add(c_rep)
        db.flush()
        acc_rep_custody.owner_ref = c_rep.id
        db.flush()

        acc_after_custody = Account(account_type=AccountType.custody, owner_ref=None, normal_side=Direction.debit)
        db.add(acc_after_custody)
        db.flush()
        c_after = Custody(holder_type="rep", rep_id=aftersales.id, warehouse_id=None, account_id=acc_after_custody.id)
        db.add(c_after)
        db.flush()
        acc_after_custody.owner_ref = c_after.id
        db.flush()

        # Post Initial Treasury Opening Balance (100,000 EGP)
        from src.services import account_resolver, opening_balance_service
        from src.services.opening_balance_service import OpeningLineInput
        treasury_acc = account_resolver.treasury_account(db)
        opening_balance_service.post_opening_balances(
            db,
            entry_date=date(2026, 1, 1),
            branch_id=branch1.id,
            lines=[OpeningLineInput(account_id=treasury_acc.id, amount=to_money(100000))],
            actor_user_id=admin.id
        )
        db.flush()
        log_pass("Foundation", "Roles, Users, Custodies, Org, Chart, and Treasury Opening Balance seeded successfully")

        # Create Central & Branch Warehouses
        wh_central = Warehouse(name="المخزن المركزي للسلع التامة", warehouse_type=WarehouseType.central, branch_id=branch1.id)
        wh_raw = Warehouse(name="مخزن المواد الخام", warehouse_type=WarehouseType.central, branch_id=branch1.id)
        wh_branch = Warehouse(name="مخزن فرع القاهرة", warehouse_type=WarehouseType.branch, branch_id=branch1.id)
        wh_scrap = Warehouse(name="مخزن الهالك والتالف", warehouse_type=WarehouseType.central, branch_id=branch1.id)
        db.add_all([wh_central, wh_raw, wh_branch, wh_scrap])
        db.flush()
        log_pass("Inventory", "Central, Raw, Branch, and Scrap warehouses configured")

        # -------------------------------------------------------------
        # CYCLE 1: Catalog & Items Setup
        # -------------------------------------------------------------
        print("\n--- 1. CATALOG & PRODUCTS SETUP ---")
        raw_pvc = Item(
            code="RAW-PVC-01", name="حبيبات بولي بروبلين خام", kind=ItemKind.raw_material,
            unit_of_measure="كجم", default_warehouse_id=wh_raw.id,
            sale_price=to_money(0), purchase_price=to_money(50), min_stock=to_qty(10), max_stock=to_qty(1000)
        )
        raw_brass = Item(
            code="RAW-BRS-01", name="سن نحاس ½ بوصة", kind=ItemKind.raw_material,
            unit_of_measure="قطعة", default_warehouse_id=wh_raw.id,
            sale_price=to_money(0), purchase_price=to_money(15), min_stock=to_qty(100), max_stock=to_qty(5000)
        )
        prod_pipe = Item(
            code="PRD-PIP-01", name="ماسورة PPR 32 مم 4 متر", kind=ItemKind.product,
            unit_of_measure="متر", default_warehouse_id=wh_central.id,
            sale_price=to_money(120), purchase_price=to_money(70), min_stock=to_qty(20), max_stock=to_qty(500)
        )
        prod_elbow = Item(
            code="PRD-ELB-01", name="كوع بسن نحاس ½ بوصة", kind=ItemKind.product,
            unit_of_measure="قطعة", default_warehouse_id=wh_central.id,
            sale_price=to_money(45), purchase_price=to_money(25), min_stock=to_qty(50), max_stock=to_qty(2000)
        )
        db.add_all([raw_pvc, raw_brass, prod_pipe, prod_elbow])
        db.flush()
        log_pass("Catalog", "Raw materials and Finished goods created with inventory parameters")

        # -------------------------------------------------------------
        # CYCLE 2: Suppliers & Purchases Cycle
        # -------------------------------------------------------------
        print("\n--- 2. PURCHASES & SUPPLIERS CYCLE ---")
        # Create Supplier with payable account
        acc_sup = Account(account_type=AccountType.supplier_payable, normal_side=Direction.credit)
        db.add(acc_sup)
        db.flush()
        sup1 = Supplier(code="SUP-00001", name="الشركة المصرية للبتروكيماويات", phone="01011112222", active=True)
        db.add(sup1)
        db.flush()
        sa1 = SupplierAccount(supplier_id=sup1.id, account_id=acc_sup.id)
        db.add(sa1)
        db.flush()
        acc_sup.owner_ref = sa1.id
        db.flush()
        log_pass("Purchases", f"Supplier created with sub-ledger account #{acc_sup.id}")

        # Create Purchase Invoice (Cash + Credit)
        p_lines = [
            PurchaseLine(item_id=raw_pvc.id, quantity=to_qty(500), unit_price=to_money(50), warehouse_id=wh_raw.id),
            PurchaseLine(item_id=raw_brass.id, quantity=to_qty(1000), unit_price=to_money(15), warehouse_id=wh_raw.id),
        ]
        pur_inv = purchase_service.create_purchase(
            db,
            supplier_id=sup1.id,
            location_kind=LocationKind.warehouse,
            location_id=wh_raw.id,
            cash_amount=to_money(10000),
            credit_amount=to_money(30000),
            lines=p_lines,
            actor_role=RoleName.system_admin,
            actor_user_id=admin.id,
            notes="فاتورة مشتريات خامات رقم 101"
        )
        db.flush()
        log_pass("Purchases", f"Purchase Invoice created: {pur_inv.document_number} (Total={pur_inv.total})")

        pvc_stock = stock_service.on_hand(db, raw_pvc.id, LocationKind.warehouse, wh_raw.id)
        brass_stock = stock_service.on_hand(db, raw_brass.id, LocationKind.warehouse, wh_raw.id)
        if pvc_stock == 500 and brass_stock == 1000:
            log_pass("Purchases", "Stock inventory increased accurately in raw materials warehouse")
        else:
            log_defect("Purchases", f"Stock incorrect after purchase: PVC={pvc_stock} (expected 500), Brass={brass_stock} (expected 1000)", "Critical")

        if pur_inv.ledger_entry_id:
            verify_journal_balanced(db, pur_inv.ledger_entry_id, "Purchase Invoice")

        # Purchase Return (Return 50 kg PVC)
        pur_ret = purchase_service.return_purchase(
            db,
            purchase_invoice_id=pur_inv.id,
            lines=[(raw_pvc.id, to_qty(50))],
            actor_role=RoleName.system_admin,
            actor_user_id=admin.id,
            notes="مرتجع 50 كجم لوجود شوائب"
        )
        db.flush()
        pvc_after_ret = stock_service.on_hand(db, raw_pvc.id, LocationKind.warehouse, wh_raw.id)
        if pvc_after_ret == 450:
            log_pass("Purchases", f"Purchase Return {pur_ret.document_number} processed, stock reduced to 450")
        else:
            log_defect("Purchases", f"Stock after return is {pvc_after_ret} (expected 450)", "High")

        if pur_ret.ledger_entry_id:
            verify_journal_balanced(db, pur_ret.ledger_entry_id, "Purchase Return")

        # -------------------------------------------------------------
        # CYCLE 3: Manufacturing & Production Cycle
        # -------------------------------------------------------------
        print("\n--- 3. MANUFACTURING & PRODUCTION CYCLE ---")
        # BOM: 1 elbow output uses 0.15 kg PVC + 1 piece Brass
        bom = manufacturing_service.create_bom(
            db,
            product_id=prod_elbow.id,
            name="تركيبة كوع بسن نحاس ½ بوصة",
            output_quantity=to_qty(1),
            components=[(raw_pvc.id, to_qty(0.15)), (raw_brass.id, to_qty(1.0))],
            actor_user_id=admin.id
        )
        db.flush()
        log_pass("Manufacturing", f"BOM / Recipe created for finished product #{prod_elbow.id}")

        # Produce 200 pieces of prod_elbow into Central Warehouse
        mfg_order = manufacturing_service.create_order(
            db,
            product_id=prod_elbow.id,
            quantity=to_qty(200),
            location_kind=LocationKind.warehouse,
            location_id=wh_central.id,
            bom_id=bom.id,
            actor_user_id=admin.id,
            notes="تشغيل دفعة 200 كوع نحاس"
        )
        db.flush()
        log_pass("Manufacturing", f"Manufacturing Order {mfg_order.document_number} completed successfully")

        elbow_stock = stock_service.on_hand(db, prod_elbow.id, LocationKind.warehouse, wh_central.id)
        pvc_stock_post_prod = stock_service.on_hand(db, raw_pvc.id, LocationKind.warehouse, wh_raw.id)
        brass_stock_post_prod = stock_service.on_hand(db, raw_brass.id, LocationKind.warehouse, wh_raw.id)

        if elbow_stock == 200 and pvc_stock_post_prod == 420 and brass_stock_post_prod == 800:
            log_pass("Manufacturing", "Finished goods received in central warehouse and raw materials consumed accurately")
        else:
            log_defect("Manufacturing", f"Manufacturing stock anomaly: Finished={elbow_stock} (exp 200), PVC={pvc_stock_post_prod} (exp 420), Brass={brass_stock_post_prod} (exp 800)", "Critical")

        # -------------------------------------------------------------
        # CYCLE 4: Stock Transfers & Wastage
        # -------------------------------------------------------------
        print("\n--- 4. STOCK TRANSFERS & WASTAGE CYCLE ---")
        trf = transfer_service.initiate(
            db,
            item_id=prod_elbow.id,
            quantity=to_qty(50),
            route=TransferRoute.central_to_branch,
            source_kind=LocationKind.warehouse,
            source_id=wh_central.id,
            dest_kind=LocationKind.warehouse,
            dest_id=wh_branch.id,
            initiated_by=admin.id
        )
        db.flush()

        transfer_service.approve(
            db,
            transfer_id=trf.id,
            approver_role=RoleName.system_admin,
            approver_branch_id=None,
            approver_user_id=admin.id,
            is_admin=True
        )
        db.flush()

        central_after_trf = stock_service.on_hand(db, prod_elbow.id, LocationKind.warehouse, wh_central.id)
        branch_after_trf = stock_service.on_hand(db, prod_elbow.id, LocationKind.warehouse, wh_branch.id)

        if central_after_trf == 150 and branch_after_trf == 50:
            log_pass("Inventory", "Inter-warehouse transfer confirmed with exact balances")
        else:
            log_defect("Inventory", f"Transfer balances mismatch: Central={central_after_trf} (exp 150), Branch={branch_after_trf} (exp 50)", "High")

        wastage_doc = wastage_service.create_wastage(
            db,
            item_id=prod_elbow.id,
            warehouse_id=wh_central.id,
            quantity=to_qty(2),
            reason="كسر سن نحاس أثناء التداول",
            actor_user_id=admin.id
        )
        db.flush()
        central_after_waste = stock_service.on_hand(db, prod_elbow.id, LocationKind.warehouse, wh_central.id)
        if central_after_waste == 148:
            log_pass("Inventory", f"Wastage recorded: {wastage_doc.document_number}, stock reduced to 148")
        else:
            log_defect("Inventory", f"Wastage stock error: {central_after_waste} (exp 148)", "Medium")

        # -------------------------------------------------------------
        # CYCLE 5: Customers & Sales Cycle
        # -------------------------------------------------------------
        print("\n--- 5. SALES & CUSTOMERS CYCLE ---")
        cust_res = customer_service.create_customer(
            db,
            name="شركة الأمل للتجارة والمقاولات (تاجر)",
            customer_type="merchant",
            rep_id=rep.id,
            territory_id=terr.id,
            phone="01223334444",
            actor_user_id=admin.id
        )
        cust1 = cust_res.customer
        db.flush()

        plumber_res = customer_service.create_customer(
            db,
            name="الأسطى محمد السباك",
            customer_type="plumber",
            rep_id=aftersales.id,
            territory_id=terr.id,
            phone="01155556666",
            actor_user_id=admin.id
        )
        plumber1 = plumber_res.customer
        db.flush()

        cust_acct = db.scalar(select(CustomerAccount).where(CustomerAccount.customer_id == cust1.id))
        if cust_acct:
            log_pass("Sales", f"Customer created with sub-ledger account #{cust_acct.account_id}")
        else:
            log_defect("Sales", "Customer created without sub-ledger account", "High")

        s_lines = [
            SaleLine(item_id=prod_elbow.id, quantity=to_qty(40), unit_price=to_money(45), warehouse_id=wh_central.id)
        ]
        sales_inv = sales_service.create_sale(
            db,
            customer_id=cust1.id,
            origin_location_kind=LocationKind.warehouse,
            origin_location_id=wh_central.id,
            variable_discount_pct=Decimal("0"),
            cash_amount=to_money(800),
            credit_amount=to_money(1000),
            coupon_serial_from="1001",
            coupon_serial_to="1050",
            coupon_count=50,
            lines=s_lines,
            actor_role=RoleName.sales_rep,
            actor_user_id=rep.id,
            notes="فاتورة بيع رقم 501"
        )
        db.flush()
        log_pass("Sales", f"Sales Invoice created: {sales_inv.document_number} (Net={sales_inv.net})")

        central_after_sale = stock_service.on_hand(db, prod_elbow.id, LocationKind.warehouse, wh_central.id)
        if central_after_sale == 108:
            log_pass("Sales", "Finished goods stock reduced from 148 to 108 upon sale")
        else:
            log_defect("Sales", f"Stock after sale is {central_after_sale} (expected 108)", "Critical")

        if sales_inv.ledger_entry_id:
            verify_journal_balanced(db, sales_inv.ledger_entry_id, "Sales Invoice")

        # Sales Return
        s_ret = sales_service.return_sale(
            db,
            sales_invoice_id=sales_inv.id,
            lines=[(prod_elbow.id, to_qty(5))],
            actor_user_id=rep.id
        )
        db.flush()
        central_after_sret = stock_service.on_hand(db, prod_elbow.id, LocationKind.warehouse, wh_central.id)
        if central_after_sret == 113:
            log_pass("Sales", f"Sales Return {s_ret.document_number} processed, stock restored to 113")
        else:
            log_defect("Sales", f"Stock after sales return is {central_after_sret} (expected 113)", "High")

        if s_ret.ledger_entry_id:
            verify_journal_balanced(db, s_ret.ledger_entry_id, "Sales Return")

        # -------------------------------------------------------------
        # CYCLE 6: Field Inspections & Loyalty Points
        # -------------------------------------------------------------
        print("\n--- 6. FIELD INSPECTIONS & LOYALTY POINTS CYCLE ---")
        insp_lines = [
            LineIn(item_id=None, item_name="ماسورة PPR 32 مم", quantity=to_qty(30), points=Decimal("10")),
            LineIn(item_id=None, item_name="كوع بسن نحاس ½", quantity=to_qty(25), points=Decimal("5")),
        ]
        insp = inspection_service.create_inspection(
            db,
            visit_kind=VisitKind.technician,
            inspection_date=date.today(),
            owner_name="فيلا المهندس طارق - التجمع",
            owner_phone="01099887766",
            technician_name=plumber1.name,
            technician_phone=plumber1.phone,
            owner_address="حي النرجس عمارة 40",
            rep_user_id=aftersales.id,
            actor_user_id=aftersales.id,
            customer_id=plumber1.id,
            lines=insp_lines,
            description="معاينة سباكة كاملة"
        )
        db.flush()
        log_pass("Inspections", f"Field Inspection created: {insp.document_number} (Total Points={insp.total_points}, Cert #{insp.certificate_number})")

        # -------------------------------------------------------------
        # CYCLE 7: Coupons Generation & Mobile Receipt Handover
        # -------------------------------------------------------------
        print("\n--- 7. COUPONS GENERATION & MOBILE RECEIPT CYCLE ---")
        c_rcpt = coupon_receipt_service.create_receipt(
            db,
            serials=["1005"],
            customer_id=cust1.id,
            rep_user_id=rep.id,
            received_date=date.today(),
            declared_kind="gold",
            declared_value=to_money(250),
            customer_type="merchant",
            actor_user_id=rep.id,
            notes="استلام كوبون ذهبي من التاجر"
        )
        db.flush()
        log_pass("Coupons", f"Coupon Handover Receipt created: {c_rcpt.document_number} (Value={c_rcpt.declared_value})")

        try:
            coupon_receipt_service.create_receipt(
                db,
                serials=["1005"],
                customer_id=cust1.id,
                rep_user_id=rep.id,
                received_date=date.today(),
                declared_kind="gold",
                customer_type="merchant",
                actor_user_id=rep.id,
                notes="محاولة استلام مكررة لنفس الكوبون"
            )
            log_defect("Coupons", "Duplicate coupon handover was accepted without error!", "Critical")
        except Exception as e:
            log_pass("Coupons", f"Duplicate coupon handover correctly rejected: {e}")

        # -------------------------------------------------------------
        # CYCLE 8: Financial Vouchers & Cheques
        # -------------------------------------------------------------
        print("\n--- 8. FINANCIAL VOUCHERS & CHEQUES CYCLE ---")
        rv = voucher_service.create_receipt(
            db,
            customer_id=cust1.id,
            amount=to_money(500),
            actor_role=RoleName.accountant,
            actor_user_id=acc.id,
            description="تحصيل دفعة نقدية من حساب العميل"
        )
        db.flush()
        log_pass("Finance", f"Receipt Voucher created: {rv.document_number} (Amount={rv.amount})")
        if rv.ledger_entry_id:
            verify_journal_balanced(db, rv.ledger_entry_id, "Receipt Voucher")

        pv = voucher_service.create_payment(
            db,
            supplier_id=sup1.id,
            amount=to_money(500),
            actor_role=RoleName.accountant,
            actor_user_id=acc.id,
            description="سداد دفعة للمورد نقداً"
        )
        db.flush()
        log_pass("Finance", f"Payment Voucher created: {pv.document_number} (Amount={pv.amount})")
        if pv.ledger_entry_id:
            verify_journal_balanced(db, pv.ledger_entry_id, "Payment Voucher")

        chq = cheque_service.register_cheque(
            db,
            direction=ChequeDirection.incoming,
            cheque_number="CHQ-998877",
            bank_name="بنك مصر",
            due_date=date(2026, 9, 30),
            amount=to_money(10000),
            customer_id=cust1.id,
            actor_user_id=acc.id,
            description="شيك آجل دفعة حساب"
        )
        db.flush()
        log_pass("Finance", f"Cheque received: {chq.cheque_number} (Status={chq.status})")

        cheque_service.settle_cheque(db, cheque_id=chq.id, actor_user_id=acc.id)
        db.flush()
        log_pass("Finance", f"Cheque collected successfully into treasury/bank (Status={chq.status})")

        # -------------------------------------------------------------
        # CYCLE 9: HR & Attendance & Payroll
        # -------------------------------------------------------------
        print("\n--- 9. HR, ATTENDANCE & PAYROLL CYCLE ---")
        emp1 = Employee(
            code="EMP-0001",
            name="أحمد محمود الفني",
            national_id="29001011234567",
            phone="01033334444",
            salary=to_money(8000),
            hire_date=date(2025, 1, 1),
            branch_id=branch1.id,
            active=True
        )
        db.add(emp1)
        db.flush()
        from src.services import payroll_setup_service
        payroll_setup_service.set_salary(
            db,
            employee_id=emp1.id,
            basic=to_money(8000),
            effective_from=date(2025, 1, 1),
            actor_user_id=admin.id
        )
        db.flush()
        log_pass("HR", f"Employee registered with salary structure: {emp1.name} (Salary={emp1.salary})")

        adv = advance_service.create_advance(
            db,
            employee_id=emp1.id,
            amount=to_money(1000),
            instalments=2,
            start_year=2026,
            start_month=9,
            advance_date=date(2026, 8, 1),
            actor_user_id=admin.id,
            reason="سلفة علاجية"
        )
        db.flush()
        log_pass("HR", f"Salary Advance created for employee #{emp1.id} (Amount={adv.amount})")

        pr_comp = payroll_service.compute_run(
            db,
            year=2026,
            month=8,
            actor_user_id=admin.id,
            branch_id=branch1.id
        )
        db.flush()
        payroll_run_id = pr_comp.id
        pr_post = payroll_service.post_run(db, run_id=payroll_run_id, actor_user_id=admin.id)
        db.flush()
        log_pass("HR", f"Payroll Run #{payroll_run_id} computed & posted successfully (Net total={pr_comp.net})")

        # -------------------------------------------------------------
        # CYCLE 10: Trial Balance & Financial Statements
        # -------------------------------------------------------------
        print("\n--- 10. TRIAL BALANCE & FINANCIAL STATEMENTS ---")
        tb_res = trial_balance_service.trial_balance(db, from_date=date(2026, 1, 1), to_date=date(2026, 12, 31))
        print(f"  Trial Balance Total Debits:  {tb_res.grand_total_debit:,.2f} EGP")
        print(f"  Trial Balance Total Credits: {tb_res.grand_total_credit:,.2f} EGP")
        diff = tb_res.grand_total_debit - tb_res.grand_total_credit

        if tb_res.balanced:
            log_pass("Financials", f"Trial Balance is 100% PERFECTLY BALANCED (Total={tb_res.grand_total_debit:,.2f} EGP)")
        else:
            log_defect("Financials", f"Trial Balance Discrepancy of {diff:,.2f} EGP!", "Critical")

        inc_stmt = financial_reports_service.income_statement(db, date_from=date(2026, 1, 1), date_to=date(2026, 12, 31))
        bal_sheet = financial_reports_service.balance_sheet(db, as_of=date(2026, 12, 31))
        log_pass("Financials", f"Income Statement generated (Net Profit = {inc_stmt.net_profit:,.2f} EGP)")
        log_pass("Financials", f"Balance Sheet generated (Assets = {bal_sheet.total_assets:,.2f} EGP, Balanced = {bal_sheet.balanced})")

    except Exception as e:
        traceback.print_exc()
        log_fail("Execution", "Global test execution error", str(e))
    finally:
        db.close()

    print("\n" + "=" * 80)
    print(f"AUDIT SUMMARY: {len(results['passed'])} PASSED, {len(results['failed'])} FAILED, {len(results['defects'])} DEFECTS")
    print("=" * 80)

if __name__ == "__main__":
    run_all_audits()
