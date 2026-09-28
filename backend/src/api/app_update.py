"""تحديث التطبيق من السيرفر — «التطبيق يتحدث مباشر، مش كل شوية نبعت update».

التطبيق مش على المتجر، فكل نسخة جديدة كانت بتتبعت APK على الواتساب لكل مندوب في الشارع.
دلوقتي التطبيق بيسأل هنا: فيه نسخة أحدث؟ ولو فيه بينزّلها ويفتح شاشة التثبيت. الدوسة
الوحيدة اللي مالهاش حل هي «تثبيت» بتاعة أندرويد — دي من النظام مش مننا.

**مافيش دخول هنا بقصد.** السؤال لازم يشتغل من شاشة الدخول كمان: المندوب اللي نسخته
القديمة مش عارفة تدخل (عنوان اتغيّر، API اتغيّر) هو أكتر واحد محتاج التحديث. والملف
نفسه هو نفس التطبيق اللي أي حد معاه — مافيهوش سر.

**مافيش رفع من هنا.** النسخة بتتحضّر على جهاز التطوير (`mobile/tool/publish_update.py`)
وبتتنسخ بإيد في `uploads/app/`. رفع APK من الويب معناه إن أي حد عنده صلاحية يقدر يوزّع
تطبيق على كل المندوبين — ده باب مايتفتحش عشان نوفّر `scp`.

شكل `latest.json`::

    {"version_code": 6, "version_name": "0.3.3", "notes": "…", "force": false,
     "files":  {"arm64-v8a": "techno-6-arm64-v8a.apk", ..., "universal": "techno-6-universal.apk"},
     "sha256": {"arm64-v8a": "…", ...},
     "size":   {"arm64-v8a": 28061662, ...}}
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

router = APIRouter(tags=["app-update"], prefix="/app-update")

# جنب باقي الرفعات — `backend/uploads/app/`، وعلى السيرفر `/opt/techno/backend/uploads/app/`.
APP_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "app"
MANIFEST = APP_ROOT / "latest.json"

# `main.py` بيركّب الراوترات كلها تحت `/api/v1`. الرابط بيرجع **من غير** اسم السيرفر:
# التطبيق بيحطّه ورا العنوان اللي هو متصل بيه، فنفس الرد يمشي على الإنتاج وعلى
# `/staging` من غير ما السيرفر يعرف هو متشاف من أنهي عنوان.
_API_ROOT = "/api/v1"

APK_MEDIA = "application/vnd.android.package-archive"


def _manifest() -> dict | None:
    """`latest.json` بعد التنضيف — أو `None` لو مش موجود أو بايظ.

    **وبتقرا كل طلب، مش مرة عند التشغيل.** نشر نسخة = نسخ ملفين، مش إعادة تشغيل الخدمة.

    **والملف اللي مش على القرص بيتشال من القايمة.** لو `latest.json` اتنسخ قبل الـAPK
    (أو النسخ وقع في النص)، التطبيق كان هيشوف نسخة جديدة ويفشل في تنزيلها كل مرة يفتح.
    كده النسخة مابتبانش لحد ما ملفها يوصل فعلاً.
    """
    try:
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    try:
        data["version_code"] = int(data.get("version_code") or 0)
    except (TypeError, ValueError):
        return None

    files = data.get("files") if isinstance(data.get("files"), dict) else {}
    present: dict[str, str] = {}
    for abi, name in files.items():
        if not isinstance(name, str) or not name:
            continue
        # اسم الملف بس — مسار جوّه `latest.json` مايخرّجناش برّه المجلد.
        if (APP_ROOT / Path(name).name).is_file():
            present[str(abi)] = Path(name).name
    data["files"] = present
    return data


@router.get("/latest")
def latest() -> dict:
    """آخر نسخة منشورة. مافيش نسخة = `{"version_code": 0}` مش خطأ.

    الصفر معناه «مافيش أحدث من اللي عندك» لأي تطبيق — فالسيرفر اللي لسه مانشرش عليه
    حاجة (أو الـstaging) مايطلّعش رسالة غلط للمندوب كل ما يفتح.
    """
    data = _manifest()
    if data is None or data["version_code"] <= 0 or not data["files"]:
        return {"version_code": 0}
    data["download_url"] = {
        abi: f"{_API_ROOT}/app-update/download/{abi}" for abi in data["files"]
    }
    return data


@router.get("/download/{abi}")
def download(abi: str) -> FileResponse:
    """ملف الـAPK للمعمارية دي — ولو مش منشورة، النسخة العامة (`universal`).

    `abi` بيتقارن بمفاتيح `latest.json` وبس، ماحدش بيبني منه مسار — فـ`../` مالهاش معنى هنا.
    """
    data = _manifest() or {"files": {}}
    files: dict[str, str] = data["files"]
    name = files.get(abi) or files.get("universal")
    if not name:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "مافيش نسخة منشورة للتطبيق."})
    path = (APP_ROOT / name).resolve()
    if path.parent != APP_ROOT.resolve() or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "ملف التحديث مش موجود على السيرفر."})
    return FileResponse(
        path,
        media_type=APK_MEDIA,
        filename=path.name,
        headers={
            # **من غير ضغط.** `GZipMiddleware` في `main.py` كانت هتضغط الملف وهو ماشي، وده
            # بيشيل `Content-Length` — والتطبيق من غيره مايعرفش يحسب النسبة، فالمندوب
            # بيبص على شريط واقف ٢٨ ميجا ومايعرفش لو بينزّل ولا علّق. والـAPK مضغوط أصلاً،
            # فالضغط التاني كان هيصرف معالج على لا شيء. الميدلوير بتعدّي أي رد عليه
            # `content-encoding`.
            "Content-Encoding": "identity",
            # الاسم فيه رقم النسخة، بس الرابط لأ — `/download/arm64-v8a` هو هو كل نسخة.
            "Cache-Control": "no-cache",
        },
    )
