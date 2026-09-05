SET NOCOUNT ON;
-- العملاء → a5_cust.tsv. عشر أعمدة بالترتيب اللي import_a5.py بيقراه:
--   0 Cust_id  1 Cust_name  2 Father_n (المحافظة)  3 area_name (المدينة)
--   4 ph1  5 Cust_adrs  6 Cust_Phones  7 brn  8 ph2  9 ph3
--
-- `ph1` مش تليفون — هو **اسم المندوب**. a5 عنده عمود مخصص (`Emp_Bos`) وهو فاضي في
-- الكشف كله، واللي بيدخّل بيكتب اسم المندوب في خانة التليفون. اتفحصت القيم: كلها
-- أسماء ولا واحدة رقم. والموبايل الحقيقي في `ph3`.
SELECT CAST(Cust_id AS VARCHAR),
       REPLACE(REPLACE(ISNULL(Cust_name,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(Father_n,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(area_name,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(ph1,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(Cust_adrs,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(Cust_Phones,''),CHAR(13),' '),CHAR(10),' '),
       CAST(ISNULL(brn,0) AS VARCHAR),
       REPLACE(REPLACE(ISNULL(ph2,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(ph3,''),CHAR(13),' '),CHAR(10),' ')
FROM Cust;
