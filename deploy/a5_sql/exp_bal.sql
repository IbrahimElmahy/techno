SET NOCOUNT ON;
-- رصيد كل صنف عند a5 → a5_bal.tsv — للتحقق بس، مش للاستيراد.
-- مشتق بنفس قاعدة المستورد: الكمية n_count_unit، بتدخل لمخزن الوارد وتخرج من الصادر.
-- verify_a5_stock.py بيقارنه برصيدنا المشتق من الحركات، بالكود الأول ثم بالاسم.
SELECT LTRIM(RTRIM(ISNULL(Item_cod,''))),
       REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(Item_name,''))),CHAR(13),' '),CHAR(10),' '),
       CAST(SUM(CASE WHEN ISNULL(StoreIn_name,'')  <> '' THEN n_count_unit ELSE 0 END)
          - SUM(CASE WHEN ISNULL(StoreOut_name,'') <> '' THEN n_count_unit ELSE 0 END) AS VARCHAR)
FROM AzonDt
GROUP BY LTRIM(RTRIM(ISNULL(Item_cod,''))),
         REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(Item_name,''))),CHAR(13),' '),CHAR(10),' ');
