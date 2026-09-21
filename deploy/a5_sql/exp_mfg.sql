SET NOCOUNT ON;
-- حركة التصنيع → a5_mfg.tsv. **بيتصدّر من تاريخ، مش كامل — عن قصد.**
--
-- `import_a5_manufacturing` بيرقّم العملية `FC-MFG-<EntgRef>-<n>`، و`<n>` ترتيبها
-- جوّه أمر التشغيل. يعني إعادة تصدير الأوامر القديمة بترتيب مختلف بتزحلق أرقام
-- عمليات اتسجّلت خلاص، والاستيراد يشوفها جديدة ويكرّرها. فالتصدير بيبدأ من بعد
-- آخر عملية اتستوردت، وأوامرها كلها جديدة — مافيش أمر نصّه قديم ونصّه جديد.
--
-- ⚠️ **غيّر `@since` لآخر تاريخ اتستورد قبل ما تشغّله.** الافتراضي هنا ٢٠٢٦-٠٩-١٤،
--    آخر عملية في التصدير الأول.
--
-- الكمية = الوحدات + الكسر: `n_count_unit` الوحدات، `n_count_single` الباقي
-- بالوحدة الصغيرة، `item_units` معامل التحويل. الشرح الكامل في `exp_lines.sql`.
--
-- الأعمدة بترتيب `import_a5_manufacturing`:
--   AznType · EntgRef · AznDate · Item_cod · Item_name · الكمية · StoreIn · StoreOut · Azn_id
DECLARE @since date = '2026-09-14';

SELECT CAST(AznType AS VARCHAR),
       CAST(EntgRef AS VARCHAR),
       CONVERT(VARCHAR(10), AznDate, 23),
       REPLACE(REPLACE(ISNULL(Item_cod,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(Item_name,''),CHAR(13),' '),CHAR(10),' '),
       CAST(CAST(ISNULL(n_count_unit,0)
                 + ISNULL(ISNULL(n_count_single,0) / NULLIF(item_units,0), 0)
            AS DECIMAL(18,4)) AS VARCHAR),
       REPLACE(REPLACE(ISNULL(StoreIn_name,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(StoreOut_name,''),CHAR(13),' '),CHAR(10),' '),
       CAST(Azn_id AS VARCHAR)
FROM AzonDt
WHERE AznType IN (4, 9) AND AznDate > @since
ORDER BY EntgRef, AznType, just_id;
