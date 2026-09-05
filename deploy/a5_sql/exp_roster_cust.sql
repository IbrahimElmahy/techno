-- كشف عملاء a5 كامل → C:\pgtmp\cust_{db}.tsv (tab + رأس عربي).
-- fix_employee_customer_types بيسأله بالكود مش بالاسم: هل `Cust_id` ده صف حقيقي عندهم؟
SELECT c.Cust_id AS رقم, c.Cust_name AS الاسم, ISNULL(c.area_name,'') AS المنطقة,
       (SELECT COUNT(*) FROM Ord o WHERE o.Cust_id = c.Cust_id) AS فواتير
FROM Cust c ORDER BY c.Cust_id
