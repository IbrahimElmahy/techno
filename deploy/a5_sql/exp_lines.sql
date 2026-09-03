SET NOCOUNT ON;
-- سطور المستندات كلها ما عدا أول المدة (اتنقلت في المرحلة التانية).
-- الكمية = n_count_unit، وإجمالي السطر بعد الخصم = a_price.
SELECT CAST(AznType AS VARCHAR), CAST(Azn_id AS VARCHAR),
       CONVERT(VARCHAR(10), AznDate, 120),
       CAST(Ord AS VARCHAR), CAST(Ord_BK AS VARCHAR),
       CAST(PoOrd AS VARCHAR), CAST(Poord_BK AS VARCHAR),
       REPLACE(REPLACE(ISNULL(Item_cod,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(Item_name,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(StoreIn_name,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(StoreOut_name,''),CHAR(13),' '),CHAR(10),' '),
       CAST(ISNULL(n_count_unit,0) AS VARCHAR),
       CAST(ISNULL(item_price,0) AS VARCHAR),
       CAST(ISNULL(a_price,0) AS VARCHAR),
       REPLACE(REPLACE(ISNULL(AznMemo,''),CHAR(13),' '),CHAR(10),' '),
       CAST(just_id AS VARCHAR),
       CAST(ISNULL(a_AvPrice,0) AS VARCHAR)
FROM AzonDt WHERE AznType <> 0 ORDER BY AznDate, Azn_id, just_id;
