#!/bin/bash
# مطابقة فرع السادات مع a5 المصنع — نسخة طبق الأصل، مرة واحدة بطلب المستخدم (مافيش كرون).
#
#   sudo -u ubuntu /opt/techno/deploy/a5_sadat_exact.sh
#
# a5 قراءة بس: التصدير (`a5_sync_factory.ps1 -ExportOnly`) واستعلامات `SELECT` عن طريق
# `a5_query.ps1` (لازم يكون في C:\techno على سيرفر المصنع). كل خطوة عندنا مقفولة على
# السادات (`--branch السادات --prefix FC-`) — العلياء وأكتوبر فيهم شغل مش في a5 ومابيتلمسوش.
# باك-أب قبل أي حاجة. الترتيب والسبب في `memory: sadat-a5-pull-sync`.
set -euo pipefail
APP=${APP:-/opt/techno}
HOST=factory.technothermeg.com
DEST="$APP/a5factory"
cd "$APP/backend"
A=(--dir "$DEST" --branch السادات --prefix FC-)
P=".venv/bin/python -m src.scripts"
DBURL=$(grep -o "^DATABASE_URL=.*" .env | cut -d= -f2- | sed "s/+psycopg2//")

# استعلام SELECT على a5 ← ملف UTF-8 عندنا. الملف لازم UTF-8 بـBOM وإلا sqlcmd بيبوّظ العربي.
a5q() {
  scp -q "$1" "$HOST:C:/techno/_q.sql"
  ssh "$HOST" "powershell -NoProfile -ExecutionPolicy Bypass -File C:\techno\a5_query.ps1 -Sql C:\techno\_q.sql -Out C:\techno\_q_out.txt"
  scp -q "$HOST:C:/techno/_q_out.txt" /tmp/_q_out16.txt
  iconv -f UTF-16LE -t UTF-8 /tmp/_q_out16.txt | sed 's/^\xEF\xBB\xBF//' | tr -d '\r' > "$2"
}

TS=$(date +%Y%m%d-%H%M%S)
pg_dump "$DBURL" -Fc -f "/tmp/techno-before-sadat-exact-$TS.dump"
sudo cp "/tmp/techno-before-sadat-exact-$TS.dump" /opt/backups/ && echo "backup $TS"

ssh "$HOST" "powershell -NoProfile -ExecutionPolicy Bypass -File C:\techno\a5_sync_factory.ps1 -ExportOnly" >/dev/null
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
for f in a5_items a5_cats a5_misc a5_cust a5_bal_store a5_hdr a5_lines a5_acc a5_open a5_emp a5_acclines a5_bal a5_mfg; do
  scp -q "$HOST:C:/pgtmp/factory/$f.tsv" "$T/$f.tsv"
done
[ -s "$T/a5_hdr.tsv" ] && [ -s "$T/a5_lines.tsv" ] || { echo "✘ تصدير فاضي — وقفت"; exit 1; }
cp "$T"/*.tsv "$DEST/"

# إجماليات الرؤوس (Emali_Bfr صفر في قاعدة المصنع) — لـfix_sadat_doc_totals.
printf '\xEF\xBB\xBFSET NOCOUNT ON;\nSELECT '"'"'S'"'"',Ord_id,Emali_Bfr,Bons,Emali_aftr,emali_aftax,totalstax,Mny_pay,Baki FROM Ord;\nSELECT '"'"'SR'"'"',Ord_id,Emali_Bfr,Bons,Emali_aftr,emali_aftax,totalstax,Mny_pay,Baki FROM OrdBK;\nSELECT '"'"'P'"'"',PoOrd_id,Emali_Bfr,Bons,Emali_aftr,emali_aftax,totalstax,Mny_pay,Baki FROM PoOrd;\nSELECT '"'"'PR'"'"',PoOrd_id,Emali_Bfr,Bons,Emali_aftr,emali_aftax,totalstax,Mny_pay,Baki FROM PoordBK;\n' > "$T/totals.sql"
a5q "$T/totals.sql" "$DEST/a5_doc_totals.txt"
# رصيد كل حساب بالدقة الكاملة لحد آخر سطر في التصدير — لـfix_a5_rounding_balances.
MAXID=$(iconv -f UTF-16LE -t UTF-8 "$DEST/a5_acclines.tsv" | awk -F"~" '{if($12+0>m)m=$12+0} END{print m}')
printf '\xEF\xBB\xBFSET NOCOUNT ON;\nSELECT '"'"'X'"'"', AccBrnch_id, CAST(SUM(ISNULL(AccIn,0)-ISNULL(AccOut,0)) AS decimal(24,6)), CAST(SUM(ROUND(ISNULL(AccIn,0),2)-ROUND(ISNULL(AccOut,0),2)) AS decimal(24,2)), COUNT(*) FROM acc WHERE acc_id <= %s GROUP BY AccBrnch_id;\n' "$MAXID" > "$T/exact.sql"
a5q "$T/exact.sql" "$DEST/a5_acc_exact.txt"

$P.import_a5 "${A[@]}" --yes | tail -12
# import_a5 بيعمل المورد الجديد من غير فرع.
psql "$DBURL" -c "update supplier set branch_id=(select id from branch where name='السادات') where branch_id is null and code like 'FC-%';"
$P.sync_a5_docs_exact "${A[@]}" --yes | head -20
for m in add_missing_a5_accounts rebuild_a5_ledger import_a5_ledger import_a5_manufacturing; do
  echo "-- $m"; $P.$m "${A[@]}" --yes | tail -3
done
$P.backfill_production_orders --prefix FC- --yes | tail -1
$P.link_sadat_parties --yes | tail -1
$P.fix_sadat_doc_totals --file "$DEST/a5_doc_totals.txt" --yes | tail -1
$P.fix_a5_rounding_balances "${A[@]}" --exact "$DEST/a5_acc_exact.txt" --yes | tail -1
echo "== تأكيد"
$P.sync_a5_docs_exact "${A[@]}" | head -1
$P.audit_a5_doc_drift --dir "$DEST" --prefix FC- | head -2
$P.verify_a5_stock_by_store --dir "$DEST" --prefix FC- | head -4 || true
echo "⚠ أمر التصنيع اللي اتعدّل في a5 مابيتكشفش هنا — فرق مخزون في خامة = أمر تشغيل محتاج يتعاد بإيد."
