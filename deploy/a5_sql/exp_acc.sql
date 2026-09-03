SET NOCOUNT ON;
-- سطور الدفتر. المفتاح `sysfree` — الطرفين ليهم نفس الرقم، و MMStnd رقم لكل صف لوحده.
SELECT CAST(sysfree AS VARCHAR), CONVERT(VARCHAR(10), Acc_Date, 120),
       CAST(AccBrnch_id AS VARCHAR),
       REPLACE(REPLACE(ISNULL(AccBrnch_n,''),CHAR(13),' '),CHAR(10),' '),
       CAST(ISNULL(AccIn,0) AS VARCHAR), CAST(ISNULL(AccOut,0) AS VARCHAR),
       REPLACE(REPLACE(ISNULL(Dscrp,''),CHAR(13),' '),CHAR(10),' '),
       CAST(ISNULL(AznType,0) AS VARCHAR),
       -- المستند اللي القيد تابع له. `AznID` مش هو: بيطابق في 1726 صف من 20158،
       -- والأعمدة دي بتطابق في الـ20158 كلهم.
       CAST(CASE AznType WHEN 7 THEN ord WHEN 2 THEN OrdBk
                         WHEN 1 THEN poord WHEN 11 THEN PoordBk
                         ELSE ISNULL(AznID,0) END AS VARCHAR),
       CAST(ISNULL(MMStnd,0) AS VARCHAR),
       REPLACE(REPLACE(ISNULL(acc_Cat,''),CHAR(13),' '),CHAR(10),' '),
       CAST(acc_id AS VARCHAR)
FROM acc ORDER BY Acc_Date, sysfree, acc_id;
