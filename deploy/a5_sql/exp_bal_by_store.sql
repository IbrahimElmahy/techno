SET NOCOUNT ON;
-- رصيد كل صنف **في كل مخزن** عند a5 → a5_bal_store.tsv — للتحقق بس، مش للاستيراد.
--
-- `exp_bal.sql` بيدّي رصيد الصنف في الشركة كلها. ده بيدّي توزيعه: نفس الإجمالي ممكن
-- يتوزّع غلط على المخازن والرقم الكلي يفضل مظبوط وماحدش ياخد باله.
--
-- **والتحويل مكتوب مرتين.** a5 بيكتب سطر التحويل **مرتين** — صف خروج وصف دخول، الاتنين
-- بنفس الصنف والكمية والمخزنين و`just_id` متتالي. اتقاس على القاعدة: ٩٬٥٧٧ زوج مطابق
-- وصف يتيم واحد.
--
-- **والطيّ بالتزاوج، مش بالقسمة على ٢.** القسمة العمياء بتغلط في الصف المفرد: بتديله
-- نص وزنه. الصف اليتيم الوحيد في القاعدة (T419 · «واى 4 بوصة» · كمية ٢) كان بيتقرا
-- هنا وحدة واحدة بينما `import_a5_docs._transfer` بيدخّله بوزنه الكامل — وبيقولها في
-- تقرير التخطّي: «صف مفرد (يتيم a5) دخل بسطر لوحده». فالفرق مكانش في الداتا، كان في إن
-- المسطرة بتقيس بقاعدة تانية غير اللي الاستيراد ماشي بيها.
--
-- `SUM(qty) / COUNT(*)` بيعمل التزاوج: الزوج المتطابق بيدّي الكمية مرة واحدة
-- (2q ÷ 2)، والصف المفرد بيدّي كميته كاملة (q ÷ 1). والتجميع بمفتاح السطر نفسه
-- (المستند + الصنف + المخزنين + الكمية) — يعني اللي بيتطوي هو المتطابق بس.
--
-- والحاجات التانية (بيع، شرا، مردود، أذون، أول مدة) مكتوبة مرة واحدة فبتتجمع بوزنها
-- الكامل.
--
-- **وأول المدة (`AznType = 0`) داخل** — ده رصيد مش حركة، ومن غيره الأرقام بتبدأ من صفر.
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
SELECT LTRIM(RTRIM(ISNULL(code,''))),
       REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(nm,''))),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(store,''))),CHAR(13),' '),CHAR(10),' '),
       CAST(SUM(qty) AS VARCHAR)
FROM (
    -- اللي مش تحويل: وزن كامل
    SELECT Item_cod AS code, Item_name AS nm, StoreIn_name AS store,
           CAST(ISNULL(n_count_unit,0) + ISNULL(ISNULL(n_count_single,0) / NULLIF(item_units,0), 0) AS DECIMAL(18,4)) AS qty
      FROM AzonDt
     WHERE ISNULL(AznType,0) <> 6 AND ISNULL(StoreIn_name,'') <> ''
    UNION ALL
    SELECT Item_cod, Item_name, StoreOut_name, -CAST(ISNULL(n_count_unit,0) + ISNULL(ISNULL(n_count_single,0) / NULLIF(item_units,0), 0) AS DECIMAL(18,4))
      FROM AzonDt
     WHERE ISNULL(AznType,0) <> 6 AND ISNULL(StoreOut_name,'') <> ''
    UNION ALL
    -- التحويل: الصف المتطابق بيتطوي مع توأمه، والمفرد بياخد وزنه كامل
    SELECT Item_cod, Item_name, StoreIn_name,
           SUM(CAST(ISNULL(n_count_unit,0) + ISNULL(ISNULL(n_count_single,0) / NULLIF(item_units,0), 0) AS DECIMAL(18,4))) / COUNT(*)
      FROM AzonDt
     WHERE ISNULL(AznType,0) = 6 AND ISNULL(StoreIn_name,'') <> ''
     GROUP BY Azn_id, Item_cod, Item_name, StoreIn_name, StoreOut_name,
              CAST(ISNULL(n_count_unit,0) + ISNULL(ISNULL(n_count_single,0) / NULLIF(item_units,0), 0) AS DECIMAL(18,4))
    UNION ALL
    SELECT Item_cod, Item_name, StoreOut_name,
           -SUM(CAST(ISNULL(n_count_unit,0) + ISNULL(ISNULL(n_count_single,0) / NULLIF(item_units,0), 0) AS DECIMAL(18,4))) / COUNT(*)
      FROM AzonDt
     WHERE ISNULL(AznType,0) = 6 AND ISNULL(StoreOut_name,'') <> ''
     GROUP BY Azn_id, Item_cod, Item_name, StoreIn_name, StoreOut_name,
              CAST(ISNULL(n_count_unit,0) + ISNULL(ISNULL(n_count_single,0) / NULLIF(item_units,0), 0) AS DECIMAL(18,4))
) x
GROUP BY LTRIM(RTRIM(ISNULL(code,''))),
         REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(nm,''))),CHAR(13),' '),CHAR(10),' '),
         REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(store,''))),CHAR(13),' '),CHAR(10),' ');
