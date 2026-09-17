"""مسودّات المستندات — اللي اتكتب ولسه ما اترحّلش.

الشاشة بتحفظ اللي مكتوب فيها وهي شغّالة، فاللي سابها في نصّها بيرجع يلاقيها. والتأكيد
مالوش علاقة بهنا: بيبعت نفس الحمولة للـAPI العادي (`POST /sales`)، وبعد ما يرجع بنجاح
المسودّة بتتمسح. يعني **مافيش طريق تاني لكتابة مستند** — التحقق والترحيل والقيد كلهم في
مكان واحد زي ما كانوا.

⛔ **المسودّة بتاعة صاحبها.** الجلب والحذف مقيّدين بـ`user_id`، ومافيش نداء بيرجّع مسودّة
حد تاني. مسودّة نص مكتوبة مش معلومة عامة: اللي يفتحها ويأكّدها يبقى رحّل مستند ناقص
باسم غيره.

والشرح الكامل لقرار «جدول مستقل مش عمود حالة» في `src.models.draft`.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, get_current_user
from src.core.db import get_db
from src.models.draft import DocumentDraft

router = APIRouter(prefix="/drafts", tags=["drafts"])

# سقف حجم الحمولة. فاتورة بمية سطر أقل من ٥٠ ك.ب بكتير؛ اللي فوق كده مش شاشة، ده حاجة
# تانية بتتبعت للجدول ده.
MAX_PAYLOAD = 512 * 1024


class DraftIn(BaseModel):
    kind: str
    title: str | None = None
    payload: dict


class DraftOut(BaseModel):
    id: int
    kind: str
    title: str | None
    payload: dict
    updated_at: str


def _out(d: DocumentDraft) -> DraftOut:
    try:
        payload = json.loads(d.payload)
    except Exception:
        # حمولة مكسورة مابتوقّعش الكشف — المسودّة بتبان فاضية وتتمسح.
        payload = {}
    return DraftOut(id=d.id, kind=d.kind, title=d.title, payload=payload,
                    updated_at=str(d.updated_at))


@router.get("", response_model=list[DraftOut])
def list_drafts(
    kind: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[DraftOut]:
    stmt = select(DocumentDraft).where(DocumentDraft.user_id == current.id)
    if kind:
        stmt = stmt.where(DocumentDraft.kind == kind)
    rows = db.scalars(stmt.order_by(DocumentDraft.updated_at.desc())).all()
    return [_out(d) for d in rows]


@router.post("", response_model=DraftOut, status_code=status.HTTP_201_CREATED)
def save_draft(
    body: DraftIn,
    draft_id: int | None = None,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DraftOut:
    """بيحفظ مسودّة جديدة، أو بيكتب فوق واحدة موجودة لو `draft_id` اتبعت.

    الكتابة فوق مقصودة: الشاشة بتحفظ كل شوية وهي شغّالة، ومن غير كده كل ضغطة زر كانت
    هتسيب مسودّة جديدة والكشف يبقى مية نسخة من نفس الفاتورة.
    """
    raw = json.dumps(body.payload, ensure_ascii=False)
    if len(raw.encode("utf-8")) > MAX_PAYLOAD:
        raise HTTPException(413, {"code": "too_large",
                                  "message": "المسودّة أكبر من اللازم."})
    row = None
    if draft_id is not None:
        row = db.scalar(select(DocumentDraft).where(
            DocumentDraft.id == draft_id, DocumentDraft.user_id == current.id))
    if row is None:
        row = DocumentDraft(
            kind=body.kind, user_id=current.id,
            branch_id=branch_scope.visible_branch_id(current),
        )
        db.add(row)
    row.title = (body.title or "")[:160] or None
    row.payload = raw
    db.commit()
    db.refresh(row)
    return _out(row)


@router.delete("/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft(
    draft_id: int,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    db.execute(sa_delete(DocumentDraft).where(
        DocumentDraft.id == draft_id, DocumentDraft.user_id == current.id))
    db.commit()
