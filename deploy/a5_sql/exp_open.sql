SET NOCOUNT ON;
-- الجرد الافتتاحي → a5_open.tsv. مافيش جدول «بضاعة أول المدة» عند a5: الأرصدة
-- الافتتاحية سطور في AzonDt بنوع AznType = 0 (وباقي التصدير بيستبعده صراحةً).
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
-- import_a5_phase2.py بيقرا: 0 كود، 1 اسم، 2/3 المخزن، 4/5/6 الكمية (أول قيمة مش صفر).
SELECT REPLACE(REPLACE(ISNULL(Item_cod,''), CHAR(13),' '), CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(Item_name,''), CHAR(13),' '), CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(StoreIn_name,''), CHAR(13),' '), CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(StoreOut_name,''), CHAR(13),' '), CHAR(10),' '),
       CAST(ISNULL(bIn_count_unit,0) + ISNULL(ISNULL(bIn_count_single,0) / NULLIF(item_units,0), 0) AS DECIMAL(18,4)),
       CAST(ISNULL(n_count_unit,0) + ISNULL(ISNULL(n_count_single,0) / NULLIF(item_units,0), 0) AS DECIMAL(18,4)),
       CAST(ISNULL(aIn_count_unit,0) + ISNULL(ISNULL(aIn_count_single,0) / NULLIF(item_units,0), 0) AS DECIMAL(18,4)),
       ISNULL(item_price,0), ISNULL(a_price,0)
FROM AzonDt WHERE AznType = 0;
