# -*- coding: utf-8 -*-
"""استقبال تصدير a5 من فرع بعيد — ورفعه بيشغّل الاستيراد.

**ليه الرفع مش السحب.** العلياء وأكتوبر قاعدتهم على نفس سيرفر الباك إند القديم، فسحبهم
سكربت محلي (`deploy/a5_sync.ps1`). المصنع سيرفر تاني خالص: ويندوز ٢٠١٢ قديم، مافيهوش
`ssh` ولا `scp` ولا `curl`، والـSSH بتاعه مقفول ورا نفق كلاودفلير — فسيرفرنا مايقدرش
يوصله. قِسنا الاتجاه التاني فطلع مفتوح: **المصنع بيوصل لـ`app.technothermeg.com` على
٤٤٣** (محتاج `Tls12` بالإيد لأن الويندوز ده افتراضيه `Ssl3, Tls`).

فالمصنع هو اللي بيصدّر ويرفع، وإحنا بنستورد. وكده **مافيش مفتاح SSH على سيرفر المصنع
ولا منفذ بيتفتح** — توكن محدود وخلاص.

**والنتيجة اللي خلّت ده لازم:** المصنع كان بيتصدّر بالإيد، وآخر استيراد كان أقدم من
آخر تصدير — فـ٢٦ إذن تحويل و٤ فواتير بيع فضلوا بره النظام، والمخزن عندنا قال بضاعة في
مكان وهي اتنقلت من أسبوع. الفرق بينا وبين a5 كان ٦١ زوج (صنف × مخزن)، ونزل ٣٧ بعد ما
اتلحقوا.

**الرفع بيكتب الملف وبيشغّل الاستيراد في نفس النداء.** فصلهم معناه إن حد لازم يفتكر
يشغّل التاني، وده بالظبط اللي فشل قبل كده. والمستوردين بيتخطوا الموجود (المستند برقمه)،
فإعادة الرفع مابتكرّرش حاجة.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, get_current_user
from src.core.db import get_db
from src.models.role import RoleName

router = APIRouter(tags=["a5-sync"], prefix="/a5-sync")


def _require_admin(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """مدير النظام وحده — الرفع بيكتب على قرص السيرفر وبيشغّل استيراد بيكتب مستندات."""
    if current.role != RoleName.system_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "لمدير النظام وحده."})
    return current

#: الفروع اللي بتقدر ترفع، وكل واحد بمجلده وبادئته. القايمة صريحة مش مشتقّة من الطلب:
#: الرفع بيكتب على القرص وبيشغّل استيراد، فاسم المجلد لازم يكون من عندنا مش من الشبكة.
def _factory_folder() -> str:
    """مجلد تصدير المصنع — بيتحدد من مكان الكود، مش مكتوب ثابت.

    الإنتاج في `/opt/techno` والتجريب في `/opt/techno-staging`، والاتنين بيشغّلوا نفس
    الملف. مسار ثابت معناه إن الرفع على التجريب بيكتب فوق ملفات الإنتاج — والاستيراد
    اللي بعده يقرا حاجة مالهاش دعوة بيه.
    """
    return str(Path(__file__).resolve().parents[2].parent / "a5factory")


BRANCHES: dict[str, tuple[str, str]] = {
    # وسم الفرع → (مجلد التصدير، بادئة أكواد الفرع)
    "factory": (_factory_folder(), "FC-"),
}

#: اسم الفرع عندنا لكل وسم — بيتبعت للمستورد.
BRANCH_NAME: dict[str, str] = {"factory": "السادات"}

#: الملفات المقبولة. أي اسم تاني بيترفض: الاسم جاي من الشبكة، والكتابة على القرص.
ALLOWED_FILES = {
    "a5_lines.tsv", "a5_hdr.tsv", "a5_items.tsv", "a5_cats.tsv",
    "a5_misc.tsv", "a5_cust.tsv", "a5_bal.tsv", "a5_bal_store.tsv",
    "a5_open.tsv", "a5_acc.tsv", "a5_emp.tsv",
}

#: سقف حجم الملف. `a5_lines.tsv` بتاع المصنع ٣٫٦ ميجا؛ الستين دول مساحة نمو واسعة،
#: واللي فوقها مش تصدير — دي حاجة تانية بتتبعت للمسار ده.
MAX_BYTES = 60 * 1024 * 1024


@router.post("/{branch_tag}/upload")
async def upload_export(
    branch_tag: str,
    file: UploadFile = File(...),
    filename: str = Form(...),
    _: CurrentUser = Depends(_require_admin),
) -> dict:
    """بيستقبل ملف تصدير واحد ويكتبه في مجلد الفرع.

    **الاسم بيتقارن بقايمة، مابيتنضّفش.** التنضيف بيسيب مجال لحالة ماحدش فكّر فيها
    (`..%2f`, رموز يونيكود شبيهة)، والقايمة بتقفل الباب: اسم مش فيها بيترفض، والمسار
    بيتبني من ثابت عندنا مش من اللي اتبعت.
    """
    if branch_tag not in BRANCHES:
        raise HTTPException(422, {"code": "validation", "message": "فرع مش معروف."})
    if filename not in ALLOWED_FILES:
        raise HTTPException(422, {"code": "validation",
                                  "message": f"الملف «{filename}» مش في القايمة المسموحة."})
    folder = Path(BRANCHES[branch_tag][0])
    if not folder.is_dir():
        raise HTTPException(500, {"code": "no_folder", "message": f"مجلد {folder} مش موجود."})

    # الكتابة في ملف مؤقت جنب الوجهة وبعدين `replace` — عشان استيراد بيقرا في نفس
    # اللحظة مايشوفش ملف نص مكتوب. و`replace` ذرّية على نفس نظام الملفات.
    size = 0
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(dir=folder, delete=False, suffix=".part") as tmp:
            tmp_path = tmp.name
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, {
                        "code": "too_large",
                        "message": f"الملف أكبر من {MAX_BYTES // (1024 * 1024)} ميجا."})
                tmp.write(chunk)
        os.replace(tmp_path, folder / filename)
        tmp_path = None
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
    return {"file": filename, "bytes": size, "folder": str(folder)}


@router.post("/{branch_tag}/import")
def run_import(
    branch_tag: str,
    _: CurrentUser = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
    """بيشغّل استيراد المستندات من الملفات اللي اترفعت.

    بيتعاد بأمان: المستورد بيتخطّى المستند اللي رقمه موجود، فالرفع المتكرر مابيكرّرش
    حاجة — بيلقّط الجديد بس، ومعاه **التعديل الرجعي** (فاتورة اتظبطت بتاريخ قديم).
    """
    if branch_tag not in BRANCHES:
        raise HTTPException(422, {"code": "validation", "message": "فرع مش معروف."})
    folder, prefix = BRANCHES[branch_tag]
    name = BRANCH_NAME[branch_tag]

    from src.scripts import import_a5_docs

    # `run` بتطبع تقريرها وبترجّع `None` — فالعدّ بيتقاس من القاعدة قبل وبعد، وده
    # أصدق من رقم بيرجع من دالة: بيعدّ اللي اتكتب فعلاً مش اللي الدالة فاكرة إنها كتبته.
    from sqlalchemy import func, select

    from src.models.transfer import StockTransfer

    def count() -> int:
        return db.scalar(select(func.count()).select_from(StockTransfer)
                         .where(StockTransfer.document_number.like(f"{prefix}T%"))) or 0

    before = count()
    try:
        import_a5_docs.run(folder, execute=True, branch_name=name, prefix=prefix)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "import_failed", "message": str(exc)}) from exc
    db.expire_all()
    return {"branch": name, "transfers_before": before, "transfers_after": count()}


@router.get("/{branch_tag}/status")
def sync_status(
    branch_tag: str,
    _: CurrentUser = Depends(_require_admin),
) -> dict:
    """آخر مرة وصل فيها كل ملف — عشان «السحب واقف من امتى» يبقى سؤال ليه إجابة.

    غياب الإجابة دي هو اللي خلّى المصنع يفضل أسبوع ورا a5 وماحدش واخد باله.
    """
    if branch_tag not in BRANCHES:
        raise HTTPException(422, {"code": "validation", "message": "فرع مش معروف."})
    folder = Path(BRANCHES[branch_tag][0])
    out = {}
    for f in sorted(ALLOWED_FILES):
        p = folder / f
        out[f] = ({"bytes": p.stat().st_size, "at": int(p.stat().st_mtime)}
                  if p.exists() else None)
    return {"folder": str(folder), "files": out}
