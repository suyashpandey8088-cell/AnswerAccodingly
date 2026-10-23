from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from pydantic import BaseModel, Field

from ..schemas.domain import (
    InteractionResult,
    NavigationResult,
    ProposedAnswer,
    TimerData,
    VerificationObservation,
)


class RawExtraction(BaseModel):
    question_id: str | None = None
    text: str
    question_type: str | None = None
    options: list[dict[str, Any]] = Field(default_factory=list)
    code_language: str | None = None
    timer: TimerData
    confidence: float = Field(default=1, ge=0, le=1)
    uncertain: bool = False
    diagnostic_refs: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AdapterError(RuntimeError):
    stage = "adapter"


class ExtractionError(AdapterError):
    stage = "extraction"


class InteractionError(AdapterError):
    stage = "interaction"


class SubmissionError(AdapterError):
    stage = "submission"


class VerificationError(AdapterError):
    stage = "verification"


class NavigationError(AdapterError):
    stage = "navigation"


class QuizAdapter(ABC):
    @abstractmethod
    async def start(self) -> float:
        """Start the target and return startup duration in milliseconds."""
        raise NotImplementedError

    @abstractmethod
    async def inspect(self) -> RawExtraction:
        raise NotImplementedError

    @abstractmethod
    async def select_answer(self, answer: ProposedAnswer) -> InteractionResult:
        raise NotImplementedError

    @abstractmethod
    async def submit(self) -> InteractionResult:
        raise NotImplementedError

    @abstractmethod
    async def wait_for_result(self) -> VerificationObservation:
        raise NotImplementedError

    @abstractmethod
    async def next_question(self) -> NavigationResult:
        raise NotImplementedError

    @abstractmethod
    async def close(self) -> None:
        raise NotImplementedError
