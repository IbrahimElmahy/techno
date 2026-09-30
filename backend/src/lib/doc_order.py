"""ترتيب سجلات المستندات: **الأحدث فوق** — بتاريخ المستند نفسه، مش بترتيب إدخاله.

طلب العميل (٢٠٢٦-٠٩-٣٠): «أي سجل عمليات يطلع الأحدث الأول وبعد كده الأقدم». السجلات
كانت مترتّبة بـ`id` تنازلي، وده بيبقى صح بس لما المستندات تتكتب بترتيب أيامها. اللي اتنقل
من a5 اتكتب دفعة واحدة وبترتيب تاني، فجرد ١/١ كان طالع فوق جرد النهارده.

الترتيب: تاريخ المستند (ولو فاضي — مستند قديم قبل الخانة — يوم تسجيله) من الأحدث، وجوّه
اليوم الواحد الأحدث تسجيلاً فوق.
"""
from __future__ import annotations

from sqlalchemy import Date, cast, func


def newest_first(model, date_col):
    """`order_by(*newest_first(StockCount, StockCount.count_date))`."""
    return (func.coalesce(date_col, cast(model.created_at, Date)).desc(), model.id.desc())
