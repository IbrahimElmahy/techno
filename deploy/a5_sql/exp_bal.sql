SET NOCOUNT ON;
-- رصيد كل صنف عند a5 → a5_bal.tsv — للتحقق بس، مش للاستيراد.
-- مشتق بنفس قاعدة المستورد: بتدخل لمخزن الوارد وتخرج من الصادر.
-- **الكمية = الوحدات + الكسر.** a5 بيكتب الكمية في عمودين: `n_count_unit` الوحدات
-- الصحيحة، و`n_count_single` الباقي بالوحدة الصغيرة، و`item_units` معامل التحويل
-- بينهم. الصنف اللي بالكيلو ومعامله ١٠٠٠ بيتكتب «١٩ و٢٥٠» يعني ١٩٫٢٥ كيلو.
--
-- التصدير كان بياخد `n_count_unit` وحده فالكسر كان بيضيع: فاتورة FC-S10780 دخلت
-- عندنا ١٩ بينما إجماليها عند a5 ٢٬٠٩٨٫٢٥ = ١٩٫٢٥ × ١٠٩. قِسناها على ٧٬٨٤٧ سطر
-- من غير خصم: الصيغة دي بتطابق الإجمالي في ٧٬٨٣٤ منهم، والقديمة في ٤٬٨٣١ بس.
--
-- والمشكلة في **فرع المصنع (السادات) وحده**: ٣٬٠٥٣ سطر فيهم كسر. العلياء وأكتوبر
-- صفر — بيبيعوا بالقطعة.
-- verify_a5_stock.py بيقارنه برصيدنا المشتق من الحركات، بالكود الأول ثم بالاسم.
SELECT LTRIM(RTRIM(ISNULL(Item_cod,''))),
       REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(Item_name,''))),CHAR(13),' '),CHAR(10),' '),
       CAST(SUM(CASE WHEN ISNULL(StoreIn_name,'')  <> '' THEN CAST(ISNULL(n_count_unit,0) + ISNULL(ISNULL(n_count_single,0) / NULLIF(item_units,0), 0) AS DECIMAL(18,4)) ELSE 0 END)
          - SUM(CASE WHEN ISNULL(StoreOut_name,'') <> '' THEN CAST(ISNULL(n_count_unit,0) + ISNULL(ISNULL(n_count_single,0) / NULLIF(item_units,0), 0) AS DECIMAL(18,4)) ELSE 0 END) AS VARCHAR)
FROM AzonDt
GROUP BY LTRIM(RTRIM(ISNULL(Item_cod,''))),
         REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(Item_name,''))),CHAR(13),' '),CHAR(10),' ');
