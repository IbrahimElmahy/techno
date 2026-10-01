"""رد JSON للقوايم الكبيرة — بيتكتب بـpydantic مباشرةً من غير `jsonable_encoder`.

الراوترات اللي بترجّع «قايمة أو صفحة» معلّمة `response_model=None` (لأن الشكل بيتغيّر مع
`limit`)، وفي الحالة دي فاست-إيه-بي-آي بيعدّي الرد كله على `jsonable_encoder`: دالة بايثون
بتلف على كل خانة في كل صف. قايمة العملاء (٣٢٠٠ صف، ١٫٦ ميجا) كانت بتاخد ٦٠٠ms في اللفة دي
لوحدها من ١٫١ ثانية — والعامل واحد، فكل الطلبات التانية بتستنى وراها.

`pydantic_core.to_json` بيكتب نفس الموديلات بنفس الشكل (`model_dump(mode="json")` اللي
`jsonable_encoder` نفسه بيناديه) بس في رست. لو الرد فيه حاجة مش موديل بنرجع للطريق القديم
بالظبط، عشان الشكل مايتغيّرش (`Decimal` برّه موديل بيطلع رقم هناك ونص هنا).
"""
from __future__ import annotations

from typing import Any

from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from pydantic_core import to_json


def _all_models(content: Any) -> bool:
    if isinstance(content, BaseModel):
        return True
    return isinstance(content, list) and all(isinstance(x, BaseModel) for x in content)


def model_json(content: Any, *, headers: dict[str, str] | None = None) -> Response:
    """رد JSON لموديل أو قايمة موديلات — نفس اللي فاست-إيه-بي-آي كان هيرجّعه، أسرع."""
    if _all_models(content):
        return Response(content=to_json(content, by_alias=True),
                        media_type="application/json", headers=headers)
    return JSONResponse(content=jsonable_encoder(content), headers=headers)
