"""جهّز نسخة جديدة من التطبيق للنشر على السيرفر — من غير ما يرفع حاجة.

    python mobile/tool/publish_update.py --notes "تصليح خصم ١٠٠٪"
    python mobile/tool/publish_update.py --notes "..." --force

بياخد الـAPKs اللي اتبنت في `mobile/build/app/outputs/flutter-apk/`، بيسمّيها برقم النسخة،
بيحسب البصمة والحجم، وبيكتب `latest.json` جنبهم في مجلد واحد (`mobile/build/update/`).
المجلد ده بيتنسخ بإيد على السيرفر في `/opt/techno/backend/uploads/app/` — والسيرفر
(`backend/src/api/app_update.py`) بيقراه من هناك.

**مابيرفعش بقصد.** النشر هنا معناه إن كل مندوب هيتطلب منه يثبّت الملف ده؛ اللحظة دي
تفضل في إيد اللي بينشر، مش في سكربت بيتشغّل من الهيستوري بالغلط.

**وبيقرا رقم النسخة من جوّه كل APK، مش بيصدّق الاسم.** الغلطة اللي بيحميك منها: تعدّل
`pubspec.yaml` وتنسى تبني تاني، فتنشر APK قديم متسمّي بالرقم الجديد. التليفون يثبّته،
يلاقي نفسه لسه على الرقم القديم، والسيرفر يقوله «فيه أحدث» — وكل ما يفتح يتطلب منه
نفس التحديث للأبد.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import struct
import sys
import zipfile
from pathlib import Path

MOBILE = Path(__file__).resolve().parents[1]
PUBSPEC = MOBILE / "pubspec.yaml"
APK_DIR = MOBILE / "build" / "app" / "outputs" / "flutter-apk"
OUT_DIR = MOBILE / "build" / "update"

# الملف اللي Flutter بيطلّعه ← المفتاح في `latest.json` (نفس أسماء `Build.SUPPORTED_ABIS`).
SOURCES = {
    "arm64-v8a": "app-arm64-v8a-release.apk",
    "armeabi-v7a": "app-armeabi-v7a-release.apk",
    "x86_64": "app-x86_64-release.apk",
    "universal": "app-release.apk",
}

# **`--split-per-abi` بيغيّر رقم النسخة.** Flutter بيحط كود المعمارية قدّامه:
# `كود × ١٠٠٠ + الرقم` — يعني النسخة ٦ بتبقى 2006 على arm64 و1006 على armeabi-v7a،
# والعامة بتفضل 6. (`FlutterPluginConstants.ABI_VERSION` في أدوات Flutter.)
# `latest.json` بيقول الرقم الأساسي (6)، والتطبيق بيقارن بباقي القسمة على ١٠٠٠.
ABI_CODE = {"armeabi-v7a": 1, "arm64-v8a": 2, "x86_64": 4, "universal": 0}

_VERSION_CODE_ATTR = 0x0101021B  # android:versionCode


def read_pubspec_version() -> tuple[str, int]:
    text = PUBSPEC.read_text(encoding="utf-8")
    m = re.search(r"^version:\s*(\d+\.\d+\.\d+)\+(\d+)\s*$", text, re.MULTILINE)
    if not m:
        sys.exit(f"مش لاقي سطر `version: x.y.z+N` في {PUBSPEC}")
    return m.group(1), int(m.group(2))


def apk_version_code(apk: Path) -> int | None:
    """`android:versionCode` من `AndroidManifest.xml` جوّه الـAPK — أو `None` لو مااتقراش.

    الملف ده XML ثنائي (AXML) مش نص. مش محتاجين غير أول عنصر (`<manifest>`) وخاصية
    واحدة فيه، فبنمشي على الكتل لحد ما نلاقيه — من غير `aapt` ولا أدوات أندرويد.
    """
    try:
        with zipfile.ZipFile(apk) as z:
            data = z.read("AndroidManifest.xml")
    except (OSError, KeyError, zipfile.BadZipFile):
        return None

    res_ids: list[int] = []
    pos = struct.unpack_from("<H", data, 2)[0]  # بعد رأس الملف
    while pos + 8 <= len(data):
        ctype, hsize, csize = struct.unpack_from("<HHI", data, pos)
        if csize <= 0:
            return None
        if ctype == 0x0180:  # خريطة الموارد: رقم مورد لكل اسم خاصية
            n = (csize - hsize) // 4
            res_ids = list(struct.unpack_from(f"<{n}I", data, pos + hsize))
        elif ctype == 0x0102:  # بداية عنصر — أول واحد هو <manifest>
            attr_start, attr_size, attr_count = struct.unpack_from("<HHH", data, pos + hsize + 8)
            base = pos + hsize + attr_start
            for i in range(attr_count):
                a = base + i * attr_size
                name_idx = struct.unpack_from("<I", data, a + 4)[0]
                dtype = data[a + 15]
                value = struct.unpack_from("<I", data, a + 16)[0]
                if name_idx < len(res_ids) and res_ids[name_idx] == _VERSION_CODE_ATTR:
                    return value if dtype in (0x10, 0x11) else None
            return None
        pos += csize
    return None


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    # الرسايل عربي، وكونسول ويندوز لما الخرج بيتحوّل لملف أو pipe بيقع على ترميز مابيكتبهوش.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(
        description="يجهّز مجلد تحديث التطبيق (APKs + latest.json) للنسخ على السيرفر. مابيرفعش حاجة.")
    ap.add_argument("--notes", default="", help="إيه الجديد — بيظهر للمندوب في رسالة التحديث")
    ap.add_argument("--force", action="store_true",
                    help="تحديث إجباري: مافيش «بعدين»، وبيتسأل عليه كل مرة التطبيق يفتح")
    ap.add_argument("--out", type=Path, default=OUT_DIR, help=f"مجلد الناتج (الافتراضي {OUT_DIR})")
    ap.add_argument("--apk-dir", type=Path, default=APK_DIR, help=f"مكان الـAPKs المبنية (الافتراضي {APK_DIR})")
    args = ap.parse_args()

    version_name, code = read_pubspec_version()
    if code >= 1000:
        # الرقم الأساسي لازم يفضل تحت ١٠٠٠ عشان حيلة `كود المعمارية × ١٠٠٠` تفضل تتفك.
        sys.exit(f"رقم النسخة {code} وصل ١٠٠٠ — التطبيق بيقارن بباقي القسمة على ١٠٠٠، راجع app_updater.dart")

    # **الأربعة لازم يكونوا موجودين.** التليفون اللي عليه نسخة معمارية (2005) مايقدرش ياخد
    # العامة (6) — أندرويد بيشوفها نسخة أقدم ويرفض. فنسخة من غير ملفات المعماريات بتقفل
    # التحديث على كل اللي خدوها قبل كده.
    missing = [src for src in SOURCES.values() if not (args.apk_dir / src).is_file()]
    if missing:
        sys.exit("ناقص: " + ", ".join(missing) + f"\nفي {args.apk_dir}\n"
                 "ابني الاتنين: `.\\build_apk.ps1` (بيعمل --split-per-abi وبعدين العامة).")

    problems = []
    for abi, src in SOURCES.items():
        expected = ABI_CODE[abi] * 1000 + code
        found = apk_version_code(args.apk_dir / src)
        if found is None:
            problems.append(f"{src}: مقدرتش أقرا رقم النسخة من جوّاه")
        elif found != expected:
            problems.append(f"{src}: جوّاه {found} والمفروض {expected} — اتبنى قبل ما pubspec يتغيّر؟")
    if problems:
        sys.exit("الـAPKs مش مطابقة لـ pubspec.yaml "
                 f"({version_name}+{code}):\n  " + "\n  ".join(problems) + "\nابني تاني وبعدين شغّل السكربت.")

    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    # نسخ قديمة في نفس المجلد كانت هتتنسخ على السيرفر مع الجديدة من غير ما حد ياخد باله.
    for old in list(out.glob("techno-*.apk")) + [out / "latest.json"]:
        old.unlink(missing_ok=True)

    manifest: dict = {
        "version_code": code,
        "version_name": version_name,
        "notes": args.notes.strip(),
        "force": bool(args.force),
        "files": {},
        "sha256": {},
        "size": {},
    }
    produced: list[Path] = []
    for abi, src in SOURCES.items():
        name = f"techno-{code}-{abi}.apk"
        dest = out / name
        shutil.copy2(args.apk_dir / src, dest)
        manifest["files"][abi] = name
        manifest["sha256"][abi] = sha256_of(dest)
        manifest["size"][abi] = dest.stat().st_size
        produced.append(dest)

    latest = out / "latest.json"
    latest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    produced.append(latest)

    print(f"نسخة {version_name} ({code}){'  — إجباري' if args.force else ''}")
    for p in produced:
        print(f"  {p}  ({p.stat().st_size:,} bytes)")
    # الملفات بالاسم مش بنجمة: scp على ويندوز مش مضمون يفك النجمة. والترتيب مقصود —
    # scp بينسخ بالترتيب، فـlatest.json بيوصل آخر حاجة ومحدش بيشوف نسخة ملفها لسه في الطريق.
    print("\nانسخهم على السيرفر (latest.json آخر واحد):")
    print("  scp " + " ".join(f'"{p}"' for p in produced)
          + " <server>:/opt/techno/backend/uploads/app/")


if __name__ == "__main__":
    main()
