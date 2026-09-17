"""الجهاز الواحد، وحساب العميل قبل الفاتورة.

عمودين جم من `main` مع الدمج، ومحدّش عمِلّهم ترحيلة — الجداول اتغيّرت في التطوير
بـ`create_all` فما بانتش، لكن قاعدة الإنتاج مابتتبنيش كده وكانت هتقع أول طلب.

**`user.session_*`** — الحساب لجهاز واحد. التوكن بيحمل `sid` والعمود ده هو القيمة
الوحيدة المقبولة، فكل تسجيل دخول بيلغي اللي قبله من أول طلب بعده. بيتساب `NULL`
للكل: يعني كل الجلسات المفتوحة دلوقتي هتحتاج تسجيل دخول جديد، وده المطلوب — مافيش
`sid` اتكتب في التوكنات القديمة أصلاً.

**`sales_invoice.prior_balance`** — حساب العميل قبل الفاتورة، بيتقفل وقت الترحيل.
لو اتحسب وقت الطباعة، ورقة اتطبعت تاني بعد شهر بتقول رقم تاني لنفس المستند. بيفضل
`NULL` للفواتير القديمة، والورقة ساعتها بتخفي السطر بدل ما تخترع صفر.

## بتسأل الأول

الترحيلة دي بتلحق أعمدة موجودة فعلاً في بعض القواعد: اللي اتبنت بـ`create_all` من
الموديلات بعد ما `main` زوّدهم فيها الأعمدة دي خلقة، واللي من قبله مالهاش. فبتقرا
الجدول وتزوّد الناقص بس — غير كده الترحيلة بتقع على
«column already exists» على نص القواعد، وترحيلة بتقع على نص الأماكن مش ترحيلة.

Revision ID: 0064_session_and_prior_balance
Revises: 0063_stock_count_kind
"""
from alembic import op
import sqlalchemy as sa

revision = "0064_session_and_prior_balance"
down_revision = "0063_stock_count_kind"
branch_labels = None
depends_on = None

_COLUMNS = [
    ("user", lambda: sa.Column("session_id", sa.String(64), nullable=True)),
    ("user", lambda: sa.Column("session_client", sa.String(16), nullable=True)),
    ("user", lambda: sa.Column("session_started_at", sa.DateTime(), nullable=True)),
    ("sales_invoice", lambda: sa.Column("prior_balance", sa.Numeric(18, 2), nullable=True)),
]


def _existing(table: str) -> set[str]:
    insp = sa.inspect(op.get_bind())
    return {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    for table in {t for t, _ in _COLUMNS}:
        have = _existing(table)
        for t, make in _COLUMNS:
            if t != table:
                continue
            col = make()
            if col.name not in have:
                op.add_column(table, col)


def downgrade() -> None:
    for table in {t for t, _ in _COLUMNS}:
        have = _existing(table)
        for t, make in reversed(_COLUMNS):
            if t == table and make().name in have:
                op.drop_column(table, make().name)
