SET NOCOUNT ON;
-- سطور المستندات كلها ما عدا أول المدة (اتنقلت في المرحلة التانية).
-- وإجمالي السطر بعد الخصم = a_price.
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
SELECT CAST(AznType AS VARCHAR), CAST(Azn_id AS VARCHAR),
       CONVERT(VARCHAR(10), AznDate, 120),
       CAST(Ord AS VARCHAR), CAST(Ord_BK AS VARCHAR),
       CAST(PoOrd AS VARCHAR), CAST(Poord_BK AS VARCHAR),
       REPLACE(REPLACE(ISNULL(Item_cod,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(Item_name,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(StoreIn_name,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(StoreOut_name,''),CHAR(13),' '),CHAR(10),' '),
       CAST(CAST(ISNULL(n_count_unit,0) + ISNULL(ISNULL(n_count_single,0) / NULLIF(item_units,0), 0) AS DECIMAL(18,4)) AS VARCHAR),
       CAST(ISNULL(item_price,0) AS VARCHAR),
       CAST(ISNULL(a_price,0) AS VARCHAR),
       REPLACE(REPLACE(ISNULL(AznMemo,''),CHAR(13),' '),CHAR(10),' '),
       CAST(just_id AS VARCHAR),
       CAST(ISNULL(a_AvPrice,0) AS VARCHAR)
FROM AzonDt WHERE AznType <> 0 ORDER BY AznDate, Azn_id, just_id;
