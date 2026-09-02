"""Database engine, session, and declarative Base (T005)."""
from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import BigInteger, Integer, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from src.core.config import settings

# BIGINT in production (MySQL/MariaDB); INTEGER on SQLite so autoincrement works in tests.
BigIntPK = BigInteger().with_variant(Integer, "sqlite")


class Base(DeclarativeBase):
    """Declarative base — the single source of truth for the schema."""


def _engine_kwargs(url: str) -> dict:
    if url.startswith("sqlite"):
        # Needed for SQLite when shared across threads (tests, single-process dev).
        return {"connect_args": {"check_same_thread": False}}
    # البركة الافتراضية ٥ + ١٠ = ١٥ اتصال. ده كان بيقفل قدام المستخدمين قبل ما القاعدة
    # تتعب: بوستجرس على السيرفر بيسمح بـ١٠٠، فكنا بنستعمل ١٥٪ من طاقته وبنخلّي الطلب
    # السادس عشر يستنى في الطابور — وشاشة التقارير أثقل طلب عندنا (٢٨٠ ملي ثانية).
    #
    # الخدمة بتشتغل بعامل واحد، فالسقف ده هو سقف العملية كلها: ٥٠ اتصال، نص اللي
    # القاعدة بتسمح بيه، والنص التاني سايبينه لـpsql والسكربتات والصيانة.
    #
    # `pool_recycle` بيرمي الاتصال اللي قعد ساعة من غير شغل. الاتصال اللي بيقعد كتير
    # بيتقفل من ناحية القاعدة أو من الشبكة من غير ما نعرف، والطلب اللي يقع عليه بيرجع
    # فشل — و`pool_pre_ping` بيمسك ده بس بعد ما يدفع رحلة زيادة على كل طلب.
    return {
        "pool_pre_ping": True,
        "pool_size": 20,
        "max_overflow": 30,
        "pool_recycle": 3600,
        "pool_timeout": 30,
    }


engine = create_engine(settings.database_url, **_engine_kwargs(settings.database_url))
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
