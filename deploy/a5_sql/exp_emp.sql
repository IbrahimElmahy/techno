SET NOCOUNT ON;
-- الموظفين والمخازن → a5_emp.tsv بوسم في أوله (import_a5_emp.py بيفرّق بـr[0]).
--   EMP   ~ Emp_id   ~ Emp_name   ~ job_name ~ Ktaa_n     ~ Brn_name ~ Emp_Phones ~ Emp_adrs ~ AccName ~ Emp_St ~ DateOut
--   STORE ~ Store_Id ~ Store_Name ~ emp_id   ~ Store_Mang ~ brn_name ~ Store_Type ~ '' ~ '' ~ '' ~ ''
-- `Stores.emp_id` مش نافع للربط — مليان في ٣ من ١١ واتنين منهم على موظف اسمه «@@»؛
-- المستورد بيربط بالاسم.
SELECT 'EMP', CAST(Emp_id AS VARCHAR),
       REPLACE(REPLACE(ISNULL(Emp_name,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(job_name,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(Ktaa_n,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(Brn_name,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(Emp_Phones,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(Emp_adrs,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(AccName,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(Emp_St,''),CHAR(13),' '),CHAR(10),' '),
       ISNULL(CONVERT(VARCHAR(10),DateOut,120),'')
FROM Emp
UNION ALL
SELECT 'STORE', CAST(Store_Id AS VARCHAR),
       REPLACE(REPLACE(ISNULL(Store_Name,''),CHAR(13),' '),CHAR(10),' '),
       CAST(ISNULL(emp_id,0) AS VARCHAR),
       REPLACE(REPLACE(ISNULL(Store_Mang,''),CHAR(13),' '),CHAR(10),' '),
       REPLACE(REPLACE(ISNULL(brn_name,''),CHAR(13),' '),CHAR(10),' '),
       CAST(ISNULL(Store_Type,0) AS VARCHAR),
       '', '', '', ''
FROM Stores;
