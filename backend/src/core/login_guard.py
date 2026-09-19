"""حارس محاولات الدخول — بيبطّأ التخمين على كلمات السر.

**اللي كان ناقص:** `POST /auth/login` كان بيقبل محاولات بلا عدد. حساب `admin` معروف
اسمه، وكلمة سر ضعيفة بتتكسر في دقائق من جهاز واحد — والسجل كان بيكتب `login.fail` بس،
يعني بيشوف الهجمة ومابيوقفهاش.

**القاعدة:** خمس محاولات فاشلة على نفس (المستخدم، العنوان) ⇒ الحساب يتقفل **من العنوان
ده** خمس دقايق. والنجاح بيصفّر العداد.

**والقفل على الزوج مش على المستخدم وحده** عن قصد: القفل على الاسم لوحده بيخلّي أي حد
يقفل حساب المدير من برّه بخمس محاولات غلط — هجوم حرمان من الخدمة أسهل من اللي بنمنعه.

**والذاكرة في العملية، مش في القاعدة.** الخدمة بتشتغل بعامل واحد، والعداد ده مالوش قيمة
بعد إعادة التشغيل. لو بقى فيه أكتر من عامل، الحارس بيضعف بنسبتهم — وساعتها مكانه
Redis أو طبقة أمام الخدمة، مش هنا. مكتوب عشان اللي بيوسّع يعرف.
"""
from __future__ import annotations

import time
from threading import Lock

#: محاولات فاشلة متتالية قبل القفل.
MAX_FAILURES = 5
#: مدة القفل بالثواني.
LOCK_SECONDS = 5 * 60
#: بعد المدة دي من غير أي محاولة، العداد بيتنسى.
FORGET_SECONDS = 15 * 60

_lock = Lock()
#: (اسم المستخدم، العنوان) → [عدد الفشل، وقت آخر فشل]
_failures: dict[tuple[str, str], list] = {}


def _prune(now: float) -> None:
    for key, (_count, last) in list(_failures.items()):
        if now - last > FORGET_SECONDS:
            _failures.pop(key, None)


def seconds_locked(username: str, ip: str) -> int:
    """كام ثانية فاضلة على القفل — صفر يعني مفيش قفل."""
    key = (username.strip().lower(), ip)
    now = time.time()
    with _lock:
        hit = _failures.get(key)
        if not hit or hit[0] < MAX_FAILURES:
            return 0
        left = LOCK_SECONDS - (now - hit[1])
        if left <= 0:
            # المدة عدّت ⇒ فرصة جديدة، والعداد بيرجع لحد القفل ناقص واحد عشان
            # المحاولة الفاشلة الجاية تقفل تاني من غير ما تبدأ من الصفر.
            _failures[key] = [MAX_FAILURES - 1, now]
            return 0
        return int(left) + 1


def record_failure(username: str, ip: str) -> None:
    key = (username.strip().lower(), ip)
    now = time.time()
    with _lock:
        _prune(now)
        hit = _failures.get(key)
        _failures[key] = [(hit[0] + 1) if hit else 1, now]


def record_success(username: str, ip: str) -> None:
    with _lock:
        _failures.pop((username.strip().lower(), ip), None)


def client_ip(request) -> str:
    """عنوان العميل — من `X-Forwarded-For` لأن الخدمة ورا nginx.

    بناخد **أول** عنوان في القايمة: ده اللي البروكسي بتاعنا حطه للعميل، واللي بعده
    بروكسيهات مالناش سيطرة عليها. ولو الهيدر مش موجود (نداء محلي) بنرجع لعنوان
    الاتصال نفسه.
    """
    fwd = request.headers.get("x-forwarded-for") if request is not None else None
    if fwd:
        return fwd.split(",")[0].strip()[:45]
    client = getattr(request, "client", None) if request is not None else None
    return (getattr(client, "host", None) or "unknown")[:45]
