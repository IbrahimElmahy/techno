SET NOCOUNT ON;
-- الأصناف → a5_items.tsv. ١٩ عمود: import_a5.py بيقرا r[0..9] و r[14] وبيرمي أي صف أقل من ١٢.
--
-- **`SaleKhsm1..5` (١٤–١٨) هي الخصم الثابت على الصنف** — خصم لكل سعر من الخمسة.
-- ٣٣٣ صنف في أكتوبر و٤١١ في العلياء عليهم ١٠٪، وهي اللي سطر الفاتورة في a5 بينزّلها
-- (`AzonDt.item_khsmp` = ١٠ في ٢٥٬٩٧١ سطر من ٢٨٬٥٧٩).
--
-- ⚠️ **`ItmKhsm` (١٢) مش الخصم.** اتفحص على ٣٨ ألف سطر بيع: مابيطابقش لا كنسبة ولا
-- كمبلغ. اتساب في التصدير عشان ماحدش يعيد اكتشافه ويفتكره هو، والقراية من ١٤.
-- السطر الجديد بيتشال من جوّه النص: في العلياء ١٣٧ اسم صنف جوّاه Enter، والتصدير
-- بيقطع الصف عندهم فبيضيع.
SELECT Item_Id, ISNULL(Cat_Id,0),
       REPLACE(REPLACE(ISNULL(Item_cod,''), CHAR(13),' '), CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(Item_Name,''), CHAR(13),' '), CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(Unit_name,''), CHAR(13),' '), CHAR(10),' '),
       ISNULL(item_price1,0), ISNULL(Item_price2,0),
       ISNULL(Item_price3,0), ISNULL(Item_price4,0), ISNULL(Item_price5,0),
       ISNULL(item_lastprice,0), ISNULL(item_avprice,0), ISNULL(ItmKhsm,0), ISNULL(wk,0),
       ISNULL(SaleKhsm1,0), ISNULL(SaleKhsm2,0), ISNULL(SaleKhsm3,0),
       ISNULL(SaleKhsm4,0), ISNULL(SaleKhsm5,0)
FROM Items;
