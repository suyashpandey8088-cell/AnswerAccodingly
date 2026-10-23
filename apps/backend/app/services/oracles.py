"""Independent verification oracles, deliberately outside the solver package."""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from ..config import REPOSITORY_DIR
from ..schemas.domain import ProposedAnswer


@lru_cache
def load_demo_oracles() -> dict[str, Any]:
    path = REPOSITORY_DIR / "fixtures" / "browser-quiz" / "oracles.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"questions": {}}


def get_oracle(profile: str | None, question_id: str | None) -> dict[str, Any] | None:
    if profile != "demo-v1" or not question_id:
        return None
    return load_demo_oracles().get("questions", {}).get(question_id)


def answers_equal(actual: ProposedAnswer | None, expected_payload: dict[str, Any] | None) -> bool | None:
    if actual is None or expected_payload is None:
        return None
    expected = ProposedAnswer.model_validate(expected_payload)
    if actual.kind != expected.kind:
        return False
    if expected.kind == "options":
        return {value.strip().casefold() for value in actual.options} == {
            value.strip().casefold() for value in expected.options
        }
    if expected.kind == "text":
        return (actual.text or "").strip().casefold() == (expected.text or "").strip().casefold()
    # Source-code text comparison is not a trustworthy coding oracle.
    return None
