from __future__ import annotations

import re
import time
from typing import Any

from ..schemas.domain import AdapterType, AnswerOption, NormalizedQuestion, QuestionType, TimerData, TimerStatus


_TIMER_PATTERN = re.compile(r"(?<!\d)(?:\d{1,3}:\d{2}(?::\d{2})?|\d+)(?!\d)")


def parse_timer(
    raw_text: str | None,
    *,
    method: str = "dom",
    confidence: float | None = 1.0,
) -> TimerData:
    """Parse documented timer formats without treating bad input as zero.

    Supported values are seconds (90), MM:SS (01:30), and HH:MM:SS
    (00:01:30). OCR confidence below 0.75 makes the value uncertain.
    """
    if raw_text is None:
        return TimerData(status=TimerStatus.absent, method=method, confidence=confidence)
    raw_text = raw_text.strip()
    if not raw_text:
        return TimerData(
            status=TimerStatus.failed,
            raw_text=raw_text,
            method=method,
            confidence=confidence,
            error="Timer element was present but empty",
        )
    match = _TIMER_PATTERN.search(raw_text)
    if not match:
        return TimerData(
            status=TimerStatus.failed,
            raw_text=raw_text,
            method=method,
            confidence=confidence,
            error="No supported timer value was recognized",
        )
    token = match.group(0)
    parts = token.split(":")
    try:
        numbers = [int(part) for part in parts]
        if len(numbers) == 1:
            seconds = numbers[0]
        elif len(numbers) == 2:
            minutes, secs = numbers
            if secs >= 60:
                raise ValueError("Seconds component must be below 60")
            seconds = minutes * 60 + secs
        elif len(numbers) == 3:
            hours, minutes, secs = numbers
            if minutes >= 60 or secs >= 60:
                raise ValueError("Minutes and seconds components must be below 60")
            seconds = hours * 3600 + minutes * 60 + secs
        else:
            raise ValueError("Unsupported timer format")
    except ValueError as exc:
        return TimerData(
            status=TimerStatus.failed,
            raw_text=raw_text,
            method=method,
            confidence=confidence,
            error=str(exc),
        )
    status = TimerStatus.uncertain if confidence is not None and confidence < 0.75 else TimerStatus.present
    return TimerData(
        status=status,
        raw_text=raw_text,
        seconds=float(seconds),
        method=method,
        confidence=confidence,
        error="OCR confidence is below the configured certainty threshold" if status == TimerStatus.uncertain else None,
    )


def classify_question(text: str, explicit_type: str | None = None, has_options: bool = False) -> QuestionType:
    if explicit_type:
        try:
            return QuestionType(explicit_type)
        except ValueError:
            pass
    lowered = text.lower()
    if any(term in lowered for term in ("write a function", "implement", "code language", "def ")):
        return QuestionType.programming
    if "select all" in lowered:
        return QuestionType.multiple_select
    if any(term in lowered for term in ("next in the sequence", "logical", "if all ", "if some ")):
        return QuestionType.logical
    if re.search(r"\d\s*[-+×x*/]\s*\d", lowered) or "calculate" in lowered:
        return QuestionType.math
    if has_options:
        return QuestionType.multiple_choice
    return QuestionType.text


def normalize_question(
    raw: dict[str, Any],
    *,
    source_adapter: AdapterType,
    extraction_duration_ms: float,
) -> NormalizedQuestion:
    text = str(raw.get("text") or "").strip()
    if not text:
        raise ValueError("Question text is missing")
    raw_options = raw.get("options") or []
    options = [
        AnswerOption(
            id=item.get("id"),
            label=str(item.get("label") or "").strip(),
            value=str(item.get("value") or item.get("label") or "").strip(),
        )
        for item in raw_options
    ]
    if any(not option.label or not option.value for option in options):
        raise ValueError("One or more answer options are incomplete")
    question_type = classify_question(text, raw.get("question_type"), bool(options))
    if question_type in {QuestionType.multiple_choice, QuestionType.multiple_select} and not options:
        raise ValueError("Choice question has no answer options")
    timer = raw.get("timer")
    if isinstance(timer, dict):
        timer = TimerData.model_validate(timer)
    elif not isinstance(timer, TimerData):
        timer = parse_timer(timer, method="dom")
    confidence = float(raw.get("confidence", 1.0))
    if raw.get("uncertain"):
        confidence = min(confidence, 0.5)
    return NormalizedQuestion(
        question_id=raw.get("question_id"),
        text=text,
        question_type=question_type,
        options=options,
        code_language=raw.get("code_language"),
        timer=timer,
        extraction_confidence=max(0, min(confidence, 1)),
        source_adapter=source_adapter,
        extraction_duration_ms=extraction_duration_ms,
        diagnostic_refs=list(raw.get("diagnostic_refs") or []),
        metadata=dict(raw.get("metadata") or {}),
    )


def monotonic_ms() -> float:
    return time.perf_counter() * 1000
