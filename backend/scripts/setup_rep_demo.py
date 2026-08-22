"""مندوب تجربة جاهز للتطبيق — بمخزنه وعميله وبضاعته.

بيشتغل على السيرفر الشغال من برّه، عن طريق الـAPI. يعني مالوش دعوة بقاعدة البيانات ولا
محتاج يتشغّل جوّه السيرفر.

    # ويندوز (PowerShell)
    $env:TECHNO_ADMIN_USER = "admin"
    $env:TECHNO_ADMIN_PASS = "..."
    py -3.11 backend/scripts/setup_rep_demo.py

    # لينكس/ماك
    TECHNO_ADMIN_USER=admin TECHNO_ADMIN_PASS=... python backend/scripts/setup_rep_demo.py

بيقرا الباسورد من البيئة عن قصد، مش من سطر الأوامر: اللي بيتكتب في السطر بيفضل في تاريخ
الشِل ومكتوب على الشاشة.

**بيتعاد تشغيله بأمان.** كل خطوة بتدوّر الأول: المستخدم اللي موجود بيتاخد زي ما هو،
والمخزن اللي اتعمل قبل كده مابيتعملش تاني، والبضاعة بتتزوّد بس لو ناقصة. عشان لو وقف
في النص (شبكة قطعت، صلاحية ناقصة) تشغّله تاني ويكمّل من مكانه.

اللي بيتعمل، وليه:

1. **مستخدم بدور مندوب** — التطبيق بيدخل بيه.
2. **مخزن باسمه، ومربوط بكارت الموظف بتاعه** — ده اللي بيبيع منه. من غيره التطبيق
   بيقوله «مالكش عهدة ولا مخزن مسجّل».
3. **عهدة باسمه** — دي بتمسك **فلوسه** مش بضاعته: التحصيل بيتقيّد فيها. من غيرها البيع
   بيقع عند القيد المحاسبي بـ«المندوب ده مالوش حساب عهدة».
4. **عميل مربوط بيه** — المندوب بيشوف عملاءه هو بس.
5. **بضاعة في مخزنه** — فاتورة شرا بتدخل الأصناف عليه، عشان يبقى في العربية حاجة تتباع.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("TECHNO_API", "https://api.technothermeg.com").rstrip("/")
ADMIN_USER = os.environ.get("TECHNO_ADMIN_USER")
ADMIN_PASS = os.environ.get("TECHNO_ADMIN_PASS")

REP_USER = os.environ.get("REP_USER", "reptest")
REP_PASS = os.environ.get("REP_PASS", "rep12345")
REP_NAME = os.environ.get("REP_NAME", "مندوب تجربة")

_token: str | None = None


def call(method: str, path: str, body: dict | None = None, *, quiet: bool = False):
    """نداء واحد على الـAPI. بيرجّع `(status, data)` بدل ما يرمي، عشان الكود اللي فوق
    يقدر يفرّق بين «مش موجود» و«فشل فعلاً»."""
    url = f"{BASE}/api/v1{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if _token:
        req.add_header("Authorization", f"Bearer {_token}")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {"detail": raw}
        if not quiet:
            print(f"   ! {method} {path} → {e.code}: {raw[:200]}")
        return e.code, parsed
    except Exception as e:  # noqa: BLE001 — شبكة قاطعة أو DNS، والرسالة هي المهمة
        print(f"   ! {method} {path} → {e}")
        return 0, None


def need(status: int, data, what: str):
    if status not in (200, 201):
        print(f"\n✖ وقف عند: {what}")
        sys.exit(1)
    return data


def main() -> None:
    global _token
    if not ADMIN_USER or not ADMIN_PASS:
        print(__doc__)
        print("✖ حطّ TECHNO_ADMIN_USER و TECHNO_ADMIN_PASS في البيئة الأول.")
        sys.exit(2)

    print(f"السيرفر: {BASE}")
    st, tok = call("POST", "/auth/login",
                   {"username": ADMIN_USER, "password": ADMIN_PASS, "client": "web"})
    need(st, tok, "تسجيل دخول الأدمن")
    _token = tok["access_token"]
    print("✔ دخلنا بالأدمن")

    # 1) المستخدم -----------------------------------------------------------------
    st, users = call("GET", "/users")
    need(st, users, "قراءة المستخدمين")
    rep = next((u for u in users if u["username"] == REP_USER), None)
    if rep is None:
        st, rep = call("POST", "/users", {
            "username": REP_USER, "password": REP_PASS,
            "role": "sales_rep", "full_name": REP_NAME})
        need(st, rep, "إنشاء المندوب")
        print(f"✔ المندوب اتعمل: {REP_USER}")
    else:
        print(f"• المندوب موجود: {REP_USER}")
    rep_id = rep["id"]

    # 2) المخزن + كارت الموظف -----------------------------------------------------
    st, whs = call("GET", "/warehouses")
    need(st, whs, "قراءة المخازن")
    wh_name = f"عربية {REP_NAME}"
    wh = next((w for w in whs if w["name"] == wh_name), None)
    if wh is None:
        # مركزي عن قصد: الفرعي بيطلب `branch_id`، والمندوب مش لازم يكون على فرع.
        st, wh = call("POST", "/warehouses",
                      {"name": wh_name, "warehouse_type": "central"})
        need(st, wh, "إنشاء مخزن المندوب")
        print(f"✔ المخزن اتعمل: {wh_name}")
    else:
        print(f"• المخزن موجود: {wh_name}")
    wh_id = wh["id"]

    st, emps = call("GET", "/employees")
    need(st, emps, "قراءة الموظفين")
    emp = next((e for e in emps if e.get("user_id") == rep_id), None)
    if emp is None:
        st, emp = call("POST", "/employees",
                       {"name": REP_NAME, "user_id": rep_id, "warehouse_id": wh_id})
        need(st, emp, "إنشاء كارت الموظف")
        print("✔ كارت الموظف اتعمل ومربوط بالمخزن")
    elif emp.get("warehouse_id") != wh_id:
        st, _ = call("PUT", f"/employees/{emp['id']}", {"warehouse_id": wh_id})
        print("✔ كارت الموظف اتربط بالمخزن" if st in (200, 201)
              else "! كارت الموظف موجود بس مااتربطش — اربطه من شاشة الموظفين")
    else:
        print("• كارت الموظف مربوط بالمخزن")

    # 3) العهدة (للفلوس) ----------------------------------------------------------
    st, custodies = call("GET", "/custodies")
    if st == 200 and not any(c.get("rep_id") == rep_id for c in custodies):
        st, _ = call("POST", "/custodies", {"holder_type": "rep", "rep_id": rep_id})
        print("✔ العهدة اتعملت (بتمسك فلوسه)" if st in (200, 201)
              else "! العهدة مااتعملتش — التحصيل هيقع من غيرها")
    else:
        print("• العهدة موجودة")

    # 4) العميل -------------------------------------------------------------------
    st, custs = call("GET", "/customers")
    need(st, custs, "قراءة العملاء")
    cust_name = "عميل تجربة"
    cust = next((c for c in custs if c["name"] == cust_name), None)
    if cust is None:
        st, terrs = call("GET", "/territories")
        terr_id = (terrs or [{}])[0].get("id") if st == 200 and terrs else None
        st, cust = call("POST", "/customers", {
            "name": cust_name, "customer_type": "trader",
            "rep_id": rep_id, "territory_id": terr_id, "phone": "01000000000"})
        need(st, cust, "إنشاء العميل")
        print(f"✔ العميل اتعمل ومربوط بالمندوب: {cust_name}")
    else:
        print(f"• العميل موجود: {cust_name}")

    # 5) بضاعة في مخزنه -----------------------------------------------------------
    st, items = call("GET", "/items")
    need(st, items, "قراءة الأصناف")
    sellable = [i for i in items if i.get("kind") == "product" and i.get("active", True)][:3]
    if not sellable:
        print("! مافيش أصناف في النظام — اعمل صنف واحد على الأقل وشغّل السكريبت تاني")
        return

    st, sups = call("GET", "/suppliers")
    sup = (sups or [None])[0] if st == 200 else None
    if sup is None:
        st, sup = call("POST", "/suppliers", {"name": "مورد تجربة"})
        need(st, sup, "إنشاء مورد")

    lines = [{"item_id": i["id"], "quantity": "20",
              "unit_price": str(i.get("purchase_price") or "50")} for i in sellable]
    total = sum(20 * float(i.get("purchase_price") or 50) for i in sellable)
    st, _ = call("POST", "/purchases", {
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": wh_id},
        "lines": lines, "cash_amount": f"{total:.2f}", "credit_amount": "0"})
    if st in (200, 201):
        print(f"✔ دخلت بضاعة على مخزنه: {len(lines)} صنف × ٢٠")
    else:
        print("! البضاعة مادخلتش — ادخلها بإذن إضافة من شاشة المخازن")

    # التأكيد الأخير: نشوف اللي التطبيق نفسه هيشوفه ----------------------------------
    st, tok = call("POST", "/auth/login",
                   {"username": REP_USER, "password": REP_PASS, "client": "mobile"})
    if st == 200:
        _token = tok["access_token"]
        st, bundle = call("GET", "/sales/rep-bundle")
        if st == 200:
            print(f"\n✔ التطبيق هيشوف: {len(bundle['customers'])} عميل، "
                  f"{len(bundle['items'])} صنف، مخزنه: "
                  f"{bundle['store_kind']} #{bundle['store_id']}")
        else:
            print("\n! حزمة المندوب مارجعتش — راجع الرسالة فوق")

    print("\n" + "=" * 46)
    print("  الدخول من التطبيق:")
    print(f"    اسم المستخدم : {REP_USER}")
    print(f"    الباسورد     : {REP_PASS}")
    print(f"    السيرفر      : {BASE}")
    print("=" * 46)


if __name__ == "__main__":
    main()
