SET NOCOUNT ON;
-- الجرد الافتتاحي → a5_open.tsv. مافيش جدول «بضاعة أول المدة» عند a5: الأرصدة
-- الافتتاحية سطور في AzonDt بنوع AznType = 0 (وباقي التصدير بيستبعده صراحةً).
-- import_a5_phase2.py بيقرا: 0 كود، 1 اسم، 2/3 المخزن، 4/5/6 الكمية (أول قيمة مش صفر).
SELECT REPLACE(REPLACE(ISNULL(Item_cod,''), CHAR(13),' '), CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(Item_name,''), CHAR(13),' '), CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(StoreIn_name,''), CHAR(13),' '), CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(StoreOut_name,''), CHAR(13),' '), CHAR(10),' '),
       ISNULL(bIn_count_unit,0), ISNULL(n_count_unit,0), ISNULL(aIn_count_unit,0),
       ISNULL(item_price,0), ISNULL(a_price,0)
FROM AzonDt WHERE AznType = 0;
