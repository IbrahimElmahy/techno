SET NOCOUNT ON;
-- رؤوس المستندات الأربعة في ملف واحد: بيع، شراء، مردود بيع، مردود شراء.
-- النص بيتنضف من السطر الجديد — التصدير بيقطع الصف عنده.
SELECT 'SALE', CAST(Ord_id AS VARCHAR), CAST(Ord_No AS VARCHAR),
       CONVERT(VARCHAR(10), Ord_Date, 120),
       REPLACE(REPLACE(ISNULL(Cust_name,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(Salerep_name,''),CHAR(13),' '),CHAR(10),' '),
       CAST(ISNULL(emali_aftax,0) AS VARCHAR), CAST(ISNULL(Bons,0) AS VARCHAR),
       CAST(ISNULL(totalstax,0) AS VARCHAR), CAST(ISNULL(Emali_aftr,0) AS VARCHAR),
       CAST(ISNULL(Mny_pay,0) AS VARCHAR), CAST(ISNULL(Baki,0) AS VARCHAR),
       CAST(ISNULL(price_type,0) AS VARCHAR),
       REPLACE(REPLACE(ISNULL(Srf_Memo,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(user_n,''),CHAR(13),' '),CHAR(10),' '),
       -- ١٦: رقم الطرف — المطابقة بالرقم مش بالاسم. الاسم على الفاتورة بيختلف عن الكشف
       -- بمسافة فيتخترع كارت `A5X` (٧٥ مرة في النقل الأول، ٤١ منهم «تكنو X» مكررين).
       CAST(ISNULL(Cust_id,0) AS VARCHAR)
FROM Ord
UNION ALL
SELECT 'BUY', CAST(PoOrd_id AS VARCHAR), CAST(PoOrd_No AS VARCHAR),
       CONVERT(VARCHAR(10), PoOrd_Date, 120),
       REPLACE(REPLACE(ISNULL(Mourd_name,''),CHAR(13),' '),CHAR(10),' '), '',
       CAST(ISNULL(emali_aftax,0) AS VARCHAR), CAST(ISNULL(Bons,0) AS VARCHAR),
       CAST(ISNULL(totalstax,0) AS VARCHAR), CAST(ISNULL(Emali_aftr,0) AS VARCHAR),
       CAST(ISNULL(Mny_pay,0) AS VARCHAR), CAST(ISNULL(Baki,0) AS VARCHAR), '0',
       REPLACE(REPLACE(ISNULL(Edafa_Memo,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(user_n,''),CHAR(13),' '),CHAR(10),' '),
       CAST(ISNULL(Mourd_id,0) AS VARCHAR)
FROM PoOrd
UNION ALL
SELECT 'SRET', CAST(Ord_id AS VARCHAR), CAST(Ord_No AS VARCHAR),
       CONVERT(VARCHAR(10), Ord_Date, 120),
       REPLACE(REPLACE(ISNULL(Cust_name,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(Salerep_name,''),CHAR(13),' '),CHAR(10),' '),
       CAST(ISNULL(emali_aftax,0) AS VARCHAR), CAST(ISNULL(Bons,0) AS VARCHAR),
       CAST(ISNULL(totalstax,0) AS VARCHAR), CAST(ISNULL(Emali_aftr,0) AS VARCHAR),
       CAST(ISNULL(Mny_pay,0) AS VARCHAR), CAST(ISNULL(Baki,0) AS VARCHAR),
       CAST(ISNULL(price_type,0) AS VARCHAR),
       REPLACE(REPLACE(ISNULL(Srf_Memo,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(user_n,''),CHAR(13),' '),CHAR(10),' '),
       CAST(ISNULL(Cust_id,0) AS VARCHAR)
FROM OrdBK
UNION ALL
SELECT 'BRET', CAST(PoOrd_id AS VARCHAR), CAST(PoOrd_No AS VARCHAR),
       CONVERT(VARCHAR(10), PoOrd_Date, 120),
       REPLACE(REPLACE(ISNULL(Mourd_name,''),CHAR(13),' '),CHAR(10),' '), '',
       CAST(ISNULL(emali_aftax,0) AS VARCHAR), CAST(ISNULL(Bons,0) AS VARCHAR),
       CAST(ISNULL(totalstax,0) AS VARCHAR), CAST(ISNULL(Emali_aftr,0) AS VARCHAR),
       CAST(ISNULL(Mny_pay,0) AS VARCHAR), CAST(ISNULL(Baki,0) AS VARCHAR), '0',
       REPLACE(REPLACE(ISNULL(Edafa_Memo,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(user_n,''),CHAR(13),' '),CHAR(10),' '),
       CAST(ISNULL(Mourd_id,0) AS VARCHAR)
FROM PoordBK;
