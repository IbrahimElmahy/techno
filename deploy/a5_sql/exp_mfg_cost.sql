SET NOCOUNT ON;
-- تكلفة حركة التصنيع عند a5 → a5_mfg_cost.tsv. **كشف تكلفة، مش تصدير حركة.**
--
-- التصدير الأصلي (`a5_mfg.tsv`) فيه كمية ومخزن وبس، فأوامر التشغيل المنقولة دخلت
-- بتكلفة صفر — والشاشة بتقول «منقول بغير تكلفة» بدل ما الصفر يتقري على إنه إنتاج
-- مجاني. لكن a5 **بيسجّل التكلفة فعلاً** على سطر التصنيع:
--
--   `item_price`  تكلفة الوحدة       ١٤٫٧٢٥٧
--   `a_price`     إجمالي السطر       ٢٧٬٣٨٩٫٨٩  =  ١٤٫٧٢٥٧ × ١٬٨٦٠
--
-- (والاسم `a_AvPrice` مضلّل — هو إجمالي كمان، مش متوسط.)
--
-- **والمفتاح هنا (الأمر، النوع، الصنف) مش ترتيب السطر.** ترتيب `a5_mfg.tsv` هو اللي
-- رقّم العمليات عندنا، وإعادة تصديره بترتيب تاني بتزحلق الأرقام — فالكشف ده بيتجنّب
-- الترتيب خالص: بيجمّع قيمة وكمية كل صنف في كل أمر، وتكلفة الوحدة بتتقسّم منهم.
--
-- الصنف اللي اتكرر في نفس الأمر بسعرين (٩ حالات من ٢٬٩٣٩) بياخد المتوسط الموزون —
-- وهو رقم صح على مستوى المجموعة، لأن ده بالظبط اللي الأمر دفعه فيه.
--
-- الكمية = الوحدات + الكسر. الشرح الكامل في `exp_lines.sql`.
SELECT CAST(AznType AS VARCHAR),
       CAST(EntgRef AS VARCHAR),
       REPLACE(REPLACE(ISNULL(Item_cod,''),CHAR(13),' '),CHAR(10),' '),
       CAST(CAST(SUM(ISNULL(a_price,0)) AS DECIMAL(18,4)) AS VARCHAR),
       CAST(CAST(SUM(ISNULL(n_count_unit,0)
                     + ISNULL(ISNULL(n_count_single,0) / NULLIF(item_units,0), 0))
            AS DECIMAL(18,4)) AS VARCHAR)
FROM AzonDt
WHERE AznType IN (4, 9)
GROUP BY AznType, EntgRef, Item_cod
ORDER BY EntgRef, AznType, Item_cod;
