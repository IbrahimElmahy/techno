SET NOCOUNT ON;
-- الأصناف → a5_items.tsv. ١٤ عمود: import_a5.py بيقرا r[0..9] وبيرمي أي صف أقل من ١٢.
-- السطر الجديد بيتشال من جوّه النص: في العلياء ١٣٧ اسم صنف جوّاه Enter، والتصدير
-- بيقطع الصف عندهم فبيضيع.
SELECT Item_Id, ISNULL(Cat_Id,0),
       REPLACE(REPLACE(ISNULL(Item_cod,''), CHAR(13),' '), CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(Item_Name,''), CHAR(13),' '), CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(Unit_name,''), CHAR(13),' '), CHAR(10),' '),
       ISNULL(item_price1,0), ISNULL(Item_price2,0),
       ISNULL(Item_price3,0), ISNULL(Item_price4,0), ISNULL(Item_price5,0),
       ISNULL(item_lastprice,0), ISNULL(item_avprice,0), ISNULL(ItmKhsm,0), ISNULL(wk,0)
FROM Items;
