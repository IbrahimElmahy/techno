#!/usr/bin/env bash
# سحب فرع المصنع (السادات) من a5 — بيتشغّل **على سيرفرنا** بالـcron، مش على المصنع.
#
#   bash /opt/techno/deploy/a5_pull_factory.sh            # الإنتاج
#   APP=/opt/techno-staging bash .../a5_pull_factory.sh   # التجريبي
#
# ---------------------------------------------------------------------------
# **ليه سحب بدل الرفع (`a5_sync_factory.ps1`).** (٢٠٢٦-١٠-٠٤) الرفع كان محتاج يوزر
# وباسورد مكتوبين في ملف على سيرفر المصنع، والملف ماكانش موجود — فالمزامنة وقفت من ٢١
# سبتمبر من غير ما حد ياخد باله. دلوقتي سيرفرنا بيدخل المصنع بمفتاح SSH خاص بيه
# (`~/.ssh/factory_pull`، مابيخرجش من السيرفر) عن طريق نفق كلاودفلير `techno-factory`،
# فمافيش باسورد في أي حتة.
#
# **a5 قراءة بس.** الجزء اللي بيشتغل على المصنع هو `a5_sync_factory.ps1 -ExportOnly`:
# `SELECT` بس، ومابيرفعش ولا بيلمس القاعدة.
#
# الاستيراد بيتخطّى المستند اللي رقمه موجود، فالتشغيل المتكرر مابيكرّرش حاجة.
set -euo pipefail

export APP=${APP:-/opt/techno}
HOST=factory.technothermeg.com
REMOTE_DIR='C:/pgtmp/factory'
DEST="$APP/a5factory"
LOG_DIR="$HOME/logs"
FILES=(a5_items a5_cats a5_misc a5_cust a5_bal_store a5_hdr a5_lines)

mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/a5_pull_factory_$(date +%F).log"
exec >>"$LOG" 2>&1

# تشغيلتين فوق بعض (cron + إيد) بيكتبوا نفس الملفات — واحدة بس في المرة.
exec 9>/tmp/a5_pull_factory.lock
flock -n 9 || { echo "$(date '+%F %T') شغّال خلاص — اتخطّى"; exit 0; }

echo "=== $(date '+%F %T') بدأ ($APP)"

ssh "$HOST" "powershell -NoProfile -ExecutionPolicy Bypass -File C:\\techno\\a5_sync_factory.ps1 -ExportOnly" >/dev/null

# التنزيل في مجلد مؤقت الأول — لو اتقطع في النص مايبقاش عندنا رؤوس جديدة على سطور قديمة.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
for f in "${FILES[@]}"; do
  scp -q "$HOST:$REMOTE_DIR/$f.tsv" "$TMP/$f.tsv"
done
# الرؤوس والسطور فاضيين = تصدير فشل في صمت (ترميز ملف الاستعلام مثلاً) — مانستوردش.
for f in a5_hdr a5_lines; do
  [ -s "$TMP/$f.tsv" ] || { echo "  ⚠ $f.tsv فاضي — وقفت من غير استيراد"; exit 1; }
done
cp "$TMP"/*.tsv "$DEST/"
echo "  الملفات: $(du -ch "$TMP"/*.tsv | tail -1 | cut -f1)"

cd "$APP/backend"
.venv/bin/python - <<'PY'
from src.scripts import import_a5_docs
import os
import_a5_docs.run(os.path.join(os.environ["APP"], "a5factory"),
                   execute=True, branch_name="السادات", prefix="FC-")
PY
echo "=== $(date '+%F %T') خلص"
