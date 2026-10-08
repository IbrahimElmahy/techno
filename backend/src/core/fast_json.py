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
    if _all_models(content):
        return Response(content=to_json(content, by_alias=True),
                        media_type="application/json", headers=headers)
    return JSONResponse(content=jsonable_encoder(content), headers=headers)
