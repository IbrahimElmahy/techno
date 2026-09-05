SET NOCOUNT ON;
-- المناطق والمخازن والموردين → a5_misc.tsv، صف بوسم في أوله (import_a5.py بيفرّق بـr[0]).
-- كل فرع من الـUNION خمس أعمدة بالظبط عشان الفهارس تفضل ثابتة:
--   AREA  ~ area_id  ~ Father_n   ~ area_name   ~ ''
--   STORE ~ Store_Id ~ Store_Name ~ ''          ~ ''
--   SUPP  ~ Mourd_id ~ Mourd_name ~ Mourd_Phones ~ Mourd_adrs
SELECT 'AREA', CAST(area_id AS VARCHAR),
       REPLACE(REPLACE(ISNULL(Father_n,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(area_name,''),CHAR(13),' '),CHAR(10),' '),
       ''
FROM Areas
UNION ALL
SELECT 'STORE', CAST(Store_Id AS VARCHAR),
       REPLACE(REPLACE(ISNULL(Store_Name,''),CHAR(13),' '),CHAR(10),' '),
       '', ''
FROM Stores
UNION ALL
SELECT 'SUPP', CAST(Mourd_id AS VARCHAR),
       REPLACE(REPLACE(ISNULL(Mourd_name,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(Mourd_Phones,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(Mourd_adrs,''),CHAR(13),' '),CHAR(10),' ')
FROM Mourd;
