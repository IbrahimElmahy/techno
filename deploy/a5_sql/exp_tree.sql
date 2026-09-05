SET NOCOUNT ON;
-- شجرة الحسابات → a5_acc.tsv بالوسوم اللي import_a5_phase2.py بيقراها:
--   MAIN ~ AccMain_id  ~ AccName    ~ Type_Nature ~ Mezan
--   SUB  ~ AccBrnch_id ~ AccBrnch_N ~ AccMain_id  ~ ''
--
-- `Type_Nature` أربع قيم عند a5: ١ رصيد مدين، ٢ رصيد دائن، ٣ مصروف، ٤ إيراد —
-- مش ترقيم ١-٥ القياسي. و`Mezan`: ١ متاجرة، ٢ أرباح وخسائر، ٣ ميزانية.
-- (النسخة القديمة exp_chart.sql كانت بتلصق الأعمدة في نص واحد بـ`~` — وa5_sync.ps1
--  بيحوّل `~` جوّه القيم لشرطة، فكانت بتتكسر. هنا أعمدة حقيقية.)
SELECT 'MAIN', CAST(AccMain_id AS VARCHAR),
       REPLACE(REPLACE(ISNULL(AccName,''),CHAR(13),' '),CHAR(10),' '),
       CAST(ISNULL(Type_Nature,0) AS VARCHAR),
       CAST(ISNULL(Mezan,0) AS VARCHAR)
FROM acc_Main
UNION ALL
SELECT 'SUB', CAST(AccBrnch_id AS VARCHAR),
       REPLACE(REPLACE(ISNULL(AccBrnch_N,''),CHAR(13),' '),CHAR(10),' '),
       CAST(ISNULL(AccMain_id,0) AS VARCHAR),
       ''
FROM accBrnch;
