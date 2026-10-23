"""Metrics use monotonic timings captured by adapters and statistics.median.

Percentiles use linear interpolation at rank (n - 1) * p, equivalent to the
common numpy.percentile(..., method="linear") definition. Empty/unmeasured
sets return None; failed measurements are never converted to zero.
"""
from __future__ import annotations

import math
import statistics
from collections import Counter
from datetime import timezone
from typing import Any, Iterable


def percentile(values: Iterable[float | None], p: float) -> float | None:
    clean = sorted(float(value) for value in values if value is not None and math.isfinite(value) and value >= 0)
    if not clean:
        return None
    if not 0 <= p <= 1:
        raise ValueError("Percentile must be between 0 and 1")
    if len(clean) == 1:
        return clean[0]
    rank = (len(clean) - 1) * p
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return clean[lower]
    return clean[lower] + (clean[upper] - clean[lower]) * (rank - lower)


def median(values: Iterable[float | None]) -> float | None:
    clean = [float(value) for value in values if value is not None and math.isfinite(value) and value >= 0]
    return statistics.median(clean) if clean else None


def stage_summary(questions: Iterable[Any]) -> dict[str, dict[str, float | int | None]]:
    values: dict[str, list[float]] = {}
    for question in questions:
        for stage, value in (question.stage_timings or {}).items():
            if isinstance(value, (int, float)) and math.isfinite(value) and value >= 0:
                values.setdefault(stage, []).append(float(value))
    return {
        stage: {
            "count": len(samples),
            "median_ms": median(samples),
            "p95_ms": percentile(samples, 0.95),
        }
        for stage, samples in sorted(values.items())
    }


def calculate_summary(run: Any, questions: list[Any]) -> dict[str, Any]:
    statuses = Counter(question.final_status for question in questions)
    assertions = [assertion for question in questions for assertion in question.assertions]
    assertion_statuses = Counter(assertion.status for assertion in assertions)
    correctness = [
        assertion for assertion in assertions if assertion.name == "independent_correctness"
    ]
    correctness_eligible = [item for item in correctness if item.status != "unknown"]
    verified = [item for item in correctness_eligible if item.status == "passed"]
    executed = [question for question in questions if question.final_status not in {"pending", "skipped"}]
    latency_samples = [
        (question.stage_timings or {}).get("total_question_ms")
        for question in executed
        if (question.stage_timings or {}).get("total_question_ms") is not None
    ]
    pass_eligible = statuses["passed"] + statuses["failed"]
    duration_ms = None
    if run.ended_at and run.started_at:
        # SQLite returns naive datetimes even for DateTime(timezone=True), while
        # newly assigned values may still be timezone-aware before commit.
        started_at = run.started_at if run.started_at.tzinfo else run.started_at.replace(tzinfo=timezone.utc)
        ended_at = run.ended_at if run.ended_at.tzinfo else run.ended_at.replace(tzinfo=timezone.utc)
        duration_ms = max(0.0, (ended_at - started_at).total_seconds() * 1000)

    categories = Counter(
        question.failure_category
        for question in questions
        if question.failure_category and question.final_status in {"failed", "timeout", "error"}
    )
    return {
        "total_questions": len(questions),
        "executed_questions": len(executed),
        "passed_questions": statuses["passed"],
        "failed_questions": statuses["failed"],
        "timeout_questions": statuses["timeout"],
        "error_questions": statuses["error"],
        "unknown_questions": statuses["unknown"],
        "skipped_questions": statuses["skipped"],
        "passed_assertions": assertion_statuses["passed"],
        "failed_assertions": assertion_statuses["failed"],
        "unknown_assertions": assertion_statuses["unknown"],
        "assertions_with_pass_criteria": len(assertions) - assertion_statuses["unknown"],
        "verified_correct_answers": len(verified),
        "correctness_eligible_answers": len(correctness_eligible),
        "pass_rate": round(statuses["passed"] / pass_eligible, 4) if pass_eligible else None,
        "verified_correctness_rate": round(len(verified) / len(correctness_eligible), 4) if correctness_eligible else None,
        "timeout_rate": round(statuses["timeout"] / len(executed), 4) if executed else None,
        "median_total_latency_ms": median(latency_samples),
        "p95_total_latency_ms": percentile(latency_samples, 0.95),
        "run_duration_ms": duration_ms,
        "failure_categories": dict(categories),
        "stage_latency": stage_summary(executed),
    }
