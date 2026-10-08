# نقطة التسليم — تحويل نصوص النظام للفصحى (فرع `msa-wip`)

أنت تكمل عملاً بدأ على هذا الفرع. اعمل على فرع `msa-wip` فقط، وارفع عليه. لا تدمج في `main` ولا تنشر على أي خادم.

## المشروع باختصار
نظام ERP عربي لشركة مواسير (ثلاثة فروع: العلياء، أكتوبر، السادات):
- `backend/` — FastAPI + SQLAlchemy (Python 3.11/3.12).
- `frontend/` — React + antd + TypeScript (واجهة من اليمين لليسار).
- `mobile/` — تطبيق Flutter للمناديب.

## المطلوب
طلب العميل الصريح:
1. كل نص يظهر للمستخدم بالعربية **الفصحى** لا العامية المصرية.
2. حذف النصوص **الشارحة** من الشاشات.
3. **لا تعليقات** في الكود إطلاقاً (حُذفت كلها مسبقاً — لا تضف أي تعليق).

القواعد التفصيلية والأمثلة في `deploy/msa/RULES.md` — اقرأها أولاً والتزم بها حرفياً، وأهمها: **لا تغيير في السلوك** (لا تغيّر نصاً تقارنه الشيفرة أو ترسله للخادم أو يُخزَّن).

## ما تم
- `frontend/src/components/**` و`hooks` و`utils` و`lib` و`print` و`api` و`App.tsx` و`main.tsx`.
- كل المجلدات الفرعية في `frontend/src/pages/` (`financeReports`، `invoices`، `ledger`، `periodClosing`، `vouchers`).
- كل ملفات `backend/src/api/`.
- فحوصات نص الخطأ في `backend/src/api` (`purchases`، `sales`، `transfers`، `hr`، `payroll`) تقبل الصيغة القديمة والجديدة.

## المتبقي
لا شيء.

اكتمل التحويل في الصفحات المباشرة `frontend/src/pages/*.tsx`، و`backend/src/services/` و`lib/` و`auth/` و`core/` و`models/` و`main.py`، و`mobile/lib/**`. أُضيفت الصيغ الجديدة إلى فحوصات نص الخطأ في `backend/src/api/payroll_setup.py` («احتُسب عليه مسير مرحّل») و`backend/src/api/vouchers.py` («غير موجود»). لم يُشغَّل `flutter analyze` لعدم توفر flutter في بيئة التنفيذ — شغّله محلياً قبل بناء التطبيق.

## مواضع حساسة
- `frontend/src/components/ShortcutsDock.tsx` يبحث عن أزرار الصفحات **بنصها**. إن غيّرت نص زر في صفحة، حدّث النص المقابل في ShortcutsDock أو أبقِ نص الزر كما هو.
- `backend/src/api/advances.py` و`leave.py` و`payroll_setup.py` تبحث عن «مسير مرحّل» داخل نص الخطأ. وكذلك `purchases.py`/`sales.py`/`transfers.py` (غير موجود/مش موجود)، `hr.py` (قبل كده/مسبقاً)، `payroll.py` (اتصرف/صُرف). إن غيّرت رسالة في الخدمات أضف الصيغة الجديدة إلى الفحص المقابل.
- `frontend/src/components/tableTotals.tsx` فيه تعبير منتظم يطابق عناوين أعمدة (منها «تليفون») — أبقه مطابقاً للعناوين الفعلية.
- قيم مثل «أبيض»، «بولي»، «معاينة»، «مرمة»، «تاجر» قيم بيانات تُرسل وتُقارن — لا تغيّرها.

## البحث عن العامية المتبقية
```bash
grep -rnE "مش |مافيش|اللي|ده |دي |كده|عشان|لسه|تاني|بتاع|هيت|اتعمل|اتحفظ|ماقدرتش|مينفعش|مالكش|عايز|دلوقتي|إيه|ليه|أيوه|تليفون|اترفع" frontend/src/pages/*.tsx backend/src/services backend/src/lib mobile/lib
```
بعض النتائج كلمات فصحى سليمة تحتوي المقطع (مثل «الأصناف») — تجاهلها.

## التحقق (إلزامي قبل الرفع)
```bash
cd frontend && npm ci && npx tsc --noEmit -p . && npx vite build --config vite.config.web.ts --outDir /tmp/msa_build
cd ../backend && python -m pip install -r requirements.txt && python -m compileall -q src && python -c "import src.main"
cd ../mobile && flutter analyze   # إن توفّر flutter: لا أخطاء (كان فيه ٢٣ ملاحظة info فقط)
```
`import src.main` يحتاج متغيّري بيئة: `DATABASE_URL=sqlite:///./tmp.db` و`JWT_SECRET=dev` يكفيان للاستيراد (قد تظهر تحذيرات sqlite عن قيود جداول — عادية).

## ممنوع
- لا اختبارات ولا كتابة اختبارات.
- لا دمج في `main`، لا نشر، لا وصول لأي خادم أو قاعدة بيانات.
- لا تعديل لملفات خارج النطاق أعلاه.

## عند الانتهاء
اعمل commit على `msa-wip` بعنوان واضح وادفعه (`git push origin msa-wip`)، ثم احذف هذا الملف أو حدّث قسم «المتبقي» ليقول «لا شيء». صاحب المشروع سيراجع الفرع ويدمجه وينشره من جهازه.
