# التحويل للفصحى — المتبقي (فرع msa-wip)

القواعد: deploy/msa/RULES.md

## تم
- مكونات frontend/src/components من A إلى M ومن N إلى Z، وhooks وutils وlib وprint وapi وApp وmain.
- كل المجلدات الفرعية في frontend/src/pages (financeReports، invoices، ledger، periodClosing، vouchers).
- كل ملفات backend/src/api.
- فحوصات نص الخطأ في backend/src/api (purchases، sales، transfers، hr، payroll) صارت تقبل الصيغة القديمة والجديدة.

## جزئي (راجع كل ملف وأكمل)
- صفحات frontend/src/pages من A إلى L (الملفات المباشرة).
- صفحات frontend/src/pages من M إلى Z (الملفات المباشرة).
- backend/src/services وlib وauth وcore وmodels (رسائل الأخطاء والتقارير والتصدير). لا تغيّر أوصاف القيود المخزنة (ميزانية، الى حـ، عكس القيد).
- mobile/lib (التطبيق).

## تحقق قبل الدمج في main
- cd frontend && npx tsc --noEmit -p .
- cd backend && .venv/Scripts/python.exe -m compileall -q src && .venv/Scripts/python.exe -c "import src.main"
- cd mobile && flutter analyze (لا أخطاء)
- ShortcutsDock يبحث عن أزرار الصفحات بنصها: تأكد أن نصوص الأزرار في components/ShortcutsDock.tsx تطابق النصوص الجديدة في الصفحات.
- api/advances.py وapi/leave.py وapi/payroll_setup.py تبحث عن «مسير مرحّل» في نص الخطأ: إن تغيّر النص في الخدمات أضف الصيغة الجديدة.
