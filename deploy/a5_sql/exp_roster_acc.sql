-- كشف حسابات a5 كامل → C:\pgtmp\acc_{db}.tsv (tab + رأس عربي).
-- اللي بيهمّ fix_employee_customer_types منه: الوظيفة (MTree2) على حساب تحت
-- «ذمم الموظفين» أو «اجور ومرتبات إدارية» — إشارة أقوى من مجرد وجود صف في Cust.
SELECT a.AccBrnch_id AS رقم, a.AccBrnch_N AS الاسم, a.AccMain_N AS المجموعة,
       ISNULL(NULLIF(LTRIM(RTRIM(a.MTree2)),''),'') AS الوظيفة,
       (SELECT COUNT(*) FROM acc x WHERE x.AccBrnch_id = a.AccBrnch_id) AS سطور
FROM accBrnch a ORDER BY a.AccBrnch_id
