"""Pydantic schema for LLM enrichment output."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

Form = Literal[
    "bias",
    "fallacy",
    "paradox",
    "thought_experiment",
    "effect",
    "heuristic",
    "phenomenon",
    "concept",
    "principle",
    "misconception",
    "law",
    "hypothesis",
]

Domain = Literal[
    "cognitive_science",
    "psychology",
    "philosophy",
    "logic",
    "mathematics",
    "physics",
    "biology",
    "economics",
    "linguistics",
    "sociology",
    "computer_science",
    "decision_theory",
    "perception",
    "ethics",
    "other",
]

Affect = Literal[
    "mind_bending",
    "practical",
    "unsettling",
    "wholesome",
    "melancholic",
    "existential",
    "funny",
    "sobering",
    "neutral",
]


class Enriched(BaseModel):
    one_liner: str = Field(..., max_length=180)
    aha_explanation: str = Field(..., min_length=60, max_length=900)
    canonical_example: str = Field(..., min_length=10, max_length=600)
    domain: list[Domain] = Field(..., min_length=1, max_length=3)
    form: Form
    affect: list[Affect] = Field(..., min_length=1, max_length=3)
    obscurity: int = Field(..., ge=1, le=5)
    prerequisites_raw: list[str] = Field(default_factory=list, max_length=5)
    surprise_score: int = Field(..., ge=1, le=10)

    @field_validator("one_liner")
    @classmethod
    def _one_line(cls, v: str) -> str:
        return " ".join(v.split())
