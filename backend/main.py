"""Vercel entry point.

Vercel's FastAPI preset (service root = `backend`) looks for an ASGI `app` in a top-level module; this
re-exports the real app defined in `src/main.py` so the rest of the codebase stays under `src/`.
"""
from src.main import app  # noqa: F401
