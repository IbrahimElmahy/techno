SET NOCOUNT ON;
-- فئات الأصناف → a5_cats.tsv. عمودين بس: الرقم والاسم (import_a5.py بيقرا r[0], r[1]).
SELECT CAST(Cat_id AS VARCHAR),
       REPLACE(REPLACE(ISNULL(Cat_Name,''),CHAR(13),' '),CHAR(10),' ')
FROM Cats;
