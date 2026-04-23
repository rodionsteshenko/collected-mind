"""Shared config. Loads .env, exposes model names and OpenAI client."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
ENRICH_MODEL = os.environ.get("OPENAI_ENRICH_MODEL", "gpt-4o-mini")
EMBED_MODEL = os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")


def openai_client():
    from openai import OpenAI

    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY not set (check .env)")
    return OpenAI(api_key=OPENAI_API_KEY)
