"""جيبين للنقطة الواحدة: رصيد معاينات ورصيد كوبونات.

النقطة اللي التاجر بيكسبها من الشرا بتتسجّل مرتين — مرة رصيد معاينات ومرة رصيد
كوبونات. اللي اشترى ٥٠ قطعة عنده ٥٠ نقطة معاينة **و**٥٠ نقطة كوبونات، مش ٥٠
يتقسموا. المعاينة بتاكل من الأولى بس، وصرف الكوبونات من التانية بس.

**عمود واحد، مش سطر كسب لكل جيب.** سطر الكسب بيفضل واحد بـ`both` وبيغذّي الاتنين،
والصرف هو اللي بيتخصّص. التالت اللي المفروض يكون الأسهل — سطرين كسب — بيضاعف
٣٠٬٥٢٠ سطر تاريخ، وبيخلّي المرتجع محتاج يلاقي السطرين ويرجّع من الاتنين بالظبط؛
وأول مرة يلاقي واحد بس بيبقى في رصيد نص صحيح ومحدش شايفه.

**والترحيل مابيغيّرش رصيد.** العمود بيتساب NULL، والقراءة بتشتقّ الجيب من `kind`
للسطر اللي `purse` بتاعه فاضي — ونوع الحركة هو اللي بيقرر الجيب أصلاً. يعني الأرصدة
صح قبل ما يتعبّى العمود وبعده، والعمود موجود عشان الحالة الوحيدة اللي مش مشتقّة:
تسوية يدوية متصوّبة على جيب واحد.

`src/scripts/backfill_point_purse.py` بيعبّي القديم لما يتشغّل — تنضيف، مش شرط تشغيل.

Revision ID: 0065_point_record_purse
Revises: 0064_session_and_prior_balance
"""
import sqlalchemy as sa
from alembic import op

revision = "0065_point_record_purse"
down_revision = "0064_session_and_prior_balance"
branch_labels = None
depends_on = None


def _has_column(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _has_index(bind, table: str, index: str) -> bool:
    return index in {i["name"] for i in sa.inspect(bind).get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()
    # بتسأل الأول: القواعد اللي اتبنت بـ`create_all` من الموديلات بعد الإضافة عندها
    # العمود خلقة، واللي قبله لأ. ترحيلة بتقع على نص الأماكن مش ترحيلة.
    if not _has_column(bind, "point_record", "purse"):
        op.add_column("point_record", sa.Column("purse", sa.String(16), nullable=True))
    if not _has_index(bind, "point_record", "ix_point_record_purse"):
        op.create_index("ix_point_record_purse", "point_record", ["purse"])


def downgrade() -> None:
    bind = op.get_bind()
    if _has_index(bind, "point_record", "ix_point_record_purse"):
        op.drop_index("ix_point_record_purse", table_name="point_record")
    if _has_column(bind, "point_record", "purse"):
        op.drop_column("point_record", "purse")
