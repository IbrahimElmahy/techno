SET NOCOUNT ON;
-- تصحيح كمية التصنيع → a5_mfg_qty.tsv. **كشف مطابقة، مش تصدير جديد.**
--
-- `a5_mfg.tsv` الأصلي هو اللي رقّم عمليات التصنيع عندنا (`FC-MFG-<ref>-<n>`)،
-- وترتيب سطوره هو اللي حدّد الرقم — فإعادة تصديره بترتيب تاني بتخلّي الأرقام تزحلق.
-- فبدل ما نعيده، بنطلّع هنا **الكمية القديمة والجديدة لكل سطر** ونطابق بيهم:
-- المفتاح (أمر التشغيل، النوع، كود الصنف، المخزنين، الكمية القديمة).
--
-- والمفتاح ده بيتكرر أحياناً: نفس الصنف اتصرف مرتين في نفس الأمر ومن نفس المخزن
-- بنفس عدد الوحدات، والكسر مختلف. ساعتها السطور بتتوزّع بالترتيب — والتوزيع ده
-- مايغيّرش الرصيد أصلاً: الصنف والمخزن والأمر واحد، فمجموع المصروف هو هو مهما
-- اتبدّلوا. عشان كده فيه `ORDER BY` هنا: نفس الترتيب كل مرة يتشغّل.
--
-- الكمية = الوحدات + الكسر: `n_count_unit` الوحدات، `n_count_single` الباقي
-- بالوحدة الصغيرة، `item_units` معامل التحويل. الشرح الكامل في `exp_lines.sql`.
SELECT CAST(AznType AS VARCHAR),
       CAST(EntgRef AS VARCHAR),
       REPLACE(REPLACE(ISNULL(Item_cod,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(StoreIn_name,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(StoreOut_name,''),CHAR(13),' '),CHAR(10),' '),
       CAST(CAST(ISNULL(n_count_unit,0) AS DECIMAL(18,4)) AS VARCHAR),
       CAST(CAST(ISNULL(n_count_unit,0)
                 + ISNULL(ISNULL(n_count_single,0) / NULLIF(item_units,0), 0)
            AS DECIMAL(18,4)) AS VARCHAR)
FROM AzonDt
WHERE AznType IN (4, 9) AND ISNULL(n_count_single,0) <> 0
ORDER BY EntgRef, AznType, just_id;
