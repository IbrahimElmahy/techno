-- كشف حسابات الموظفين تحت «ذمم الموظفين» → C:\pgtmp\emp_{AL|OCT}.tsv
-- بفاصل tab وصف عناوين عربي — بيتقرا بـcsv.DictReader في import_a5_employee_cards
-- وfix_employee_customer_types. التطبيع بيحافظ على الهمزة عن قصد: a5 بيفرّق بيها.
SELECT a.AccBrnch_N AS الاسم, a.Brnch_Cod AS كود_الحساب, a.AccBrnch_id AS رقم_الحساب,
       ISNULL(NULLIF(LTRIM(RTRIM(a.MTree2)),''),'') AS الوظيفة,
       CASE WHEN EXISTS (
         SELECT 1 FROM Cust c WHERE
           REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(c.Cust_name)),N'ة',N'ه'),N'ى',N'ي'),N'ـ',''),N'  ',N' '),N'  ',N' ')
         = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(a.AccBrnch_N)),N'ة',N'ه'),N'ى',N'ي'),N'ـ',''),N'  ',N' '),N'  ',N' ')
       ) THEN 1 ELSE 0 END AS في_كشف_العملاء,
       (SELECT COUNT(*) FROM Ord o WHERE
           REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(o.Cust_name)),N'ة',N'ه'),N'ى',N'ي'),N'ـ',''),N'  ',N' '),N'  ',N' ')
         = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(a.AccBrnch_N)),N'ة',N'ه'),N'ى',N'ي'),N'ـ',''),N'  ',N' '),N'  ',N' ')) AS فواتير
FROM accBrnch a
WHERE a.AccMain_N = N'ذمم الموظفين'
ORDER BY 4, 5 DESC, 1
