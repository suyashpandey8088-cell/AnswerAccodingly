"""Shared, adapter-independent domain schemas."""
from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AdapterType(str, Enum):
    browser = "browser"
    desktop = "desktop"


class QuestionType(str, Enum):
    multiple_choice = "multiple_choice"
    multiple_select = "multiple_select"
    math = "math"
    logical = "logical"
    text = "text"
    programming = "programming"
    unknown = "unknown"


class TestStatus(str, Enum):
    pending = "pending"
    running = "running"
    passed = "passed"
    failed = "failed"
    timeout = "timeout"
    error = "error"
    unknown = "unknown"
    skipped = "skipped"


class RunStatus(str, Enum):
    pending = "pending"
    running = "running"
    passed = "passed"
    failed = "failed"
    timeout = "timeout"
    error = "error"
    unknown = "unknown"
    skipped = "skipped"
    cancelled = "cancelled"


class TimerStatus(str, Enum):
    """Absent, unreadable and uncertain timers are deliberately distinct."""

    present = "present"
    absent = "absent"
    failed = "failed"
    uncertain = "uncertain"


class TimerData(BaseModel):
    status: TimerStatus
    raw_text: str | None = None
    seconds: float | None = Field(default=None, ge=0)
    method: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    error: str | None = None


class AnswerOption(BaseModel):
    id: str | None = None
    label: str
    value: str


class NormalizedQuestion(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    question_id: str | None = None
    text: str = Field(min_length=1)
    question_type: QuestionType
    options: list[AnswerOption] = Field(default_factory=list)
    code_language: str | None = None
    timer: TimerData
    extraction_confidence: float = Field(ge=0, le=1)
    source_adapter: AdapterType
    extraction_duration_ms: float = Field(ge=0)
    diagnostic_refs: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("text")
    @classmethod
    def strip_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Question text cannot be empty")
        return value


class ProposedAnswer(BaseModel):
    kind: Literal["options", "text", "code"]
    options: list[str] = Field(default_factory=list)
    text: str | None = None
    code: str | None = None
    language: str | None = None


class SolverStatus(str, Enum):
    solved = "solved"
    uncertain = "uncertain"
    error = "error"
    timeout = "timeout"
    unsupported = "unsupported"


class SolverResult(BaseModel):
    status: SolverStatus
    answer: ProposedAnswer | None = None
    confidence: float = Field(default=0, ge=0, le=1)
    method: str
    provider: str | None = None
    model: str | None = None
    duration_ms: float = Field(default=0, ge=0)
    validation_status: Literal["valid", "invalid", "not_applicable"] = "not_applicable"
    uncertainty_reason: str | None = None
    error: str | None = None
    retry_count: int = Field(default=0, ge=0)
    sandbox_status: Literal["not_required", "passed", "failed", "unsupported", "timeout", "error"] = "not_required"
    sandbox_details: dict[str, Any] | None = None


class AssertionStatus(str, Enum):
    passed = "passed"
    failed = "failed"
    unknown = "unknown"


class AssertionOutcome(BaseModel):
    name: str
    expected: Any = None
    actual: Any = None
    status: AssertionStatus
    explanation: str


class StageTimings(BaseModel):
    browser_startup_ms: float | None = None
    extraction_ms: float | None = None
    ocr_ms: float | None = None
    timer_parsing_ms: float | None = None
    classification_ms: float | None = None
    solver_ms: float | None = None
    ai_provider_ms: float | None = None
    selection_ms: float | None = None
    submission_ms: float | None = None
    ui_response_ms: float | None = None
    verification_ms: float | None = None
    navigation_ms: float | None = None
    total_question_ms: float | None = None


class InteractionResult(BaseModel):
    success: bool
    # True means the expected UI state was observed; None means the adapter
    # performed an action but cannot establish the resulting state.
    verified: bool | None = True
    actual: Any = None
    duration_ms: float = Field(ge=0)
    error: str | None = None


class VerificationObservation(BaseModel):
    feedback_visible: bool
    outcome: Literal["correct", "incorrect", "unknown"] = "unknown"
    text: str | None = None
    duration_ms: float = Field(ge=0)
    timed_out: bool = False
    error: str | None = None


class NavigationResult(BaseModel):
    success: bool
    has_next: bool
    question_id: str | None = None
    duration_ms: float = Field(ge=0)
    error: str | None = None
