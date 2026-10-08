from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

router = APIRouter(tags=["app-update"], prefix="/app-update")

APP_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "app"
MANIFEST = APP_ROOT / "latest.json"

_API_ROOT = "/api/v1"

APK_MEDIA = "application/vnd.android.package-archive"


def _manifest() -> dict | None:
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
        if (APP_ROOT / Path(name).name).is_file():
            present[str(abi)] = Path(name).name
    data["files"] = present
    return data


@router.get("/latest")
def latest() -> dict:
    data = _manifest()
    if data is None or data["version_code"] <= 0 or not data["files"]:
        return {"version_code": 0}
    data["download_url"] = {
        abi: f"{_API_ROOT}/app-update/download/{abi}" for abi in data["files"]
    }
    return data


@router.get("/download/{abi}")
def download(abi: str) -> FileResponse:
    data = _manifest() or {"files": {}}
    files: dict[str, str] = data["files"]
    name = files.get(abi) or files.get("universal")
    if not name:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "لا توجد نسخة منشورة للتطبيق."})
    path = (APP_ROOT / name).resolve()
    if path.parent != APP_ROOT.resolve() or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "ملف التحديث غير موجود على الخادم."})
    return FileResponse(
        path,
        media_type=APK_MEDIA,
        filename=path.name,
        headers={
            "Content-Encoding": "identity",
            "Cache-Control": "no-cache",
        },
    )
