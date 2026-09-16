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

Revision ID: 0064_session_and_prior_balance
Revises: 0063_stock_count_kind
"""
from alembic import op
import sqlalchemy as sa

revision = "0064_session_and_prior_balance"
down_revision = "0063_stock_count_kind"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user", sa.Column("session_id", sa.String(64), nullable=True))
    op.add_column("user", sa.Column("session_client", sa.String(16), nullable=True))
    op.add_column("user", sa.Column("session_started_at", sa.DateTime(), nullable=True))
    op.add_column("sales_invoice", sa.Column(
        "prior_balance", sa.Numeric(18, 2), nullable=True))


def downgrade() -> None:
    op.drop_column("sales_invoice", "prior_balance")
    op.drop_column("user", "session_started_at")
    op.drop_column("user", "session_client")
    op.drop_column("user", "session_id")
