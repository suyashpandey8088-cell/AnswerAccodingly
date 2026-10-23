from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field, ValidationError

from ..schemas.domain import NormalizedQuestion, ProposedAnswer, QuestionType, SolverResult, SolverStatus
from .base import Solver


class StructuredLLMAnswer(BaseModel):
    """Provider output is untrusted until this schema and answer checks pass."""

    outcome: Literal["solved", "uncertain"]
    kind: Literal["options", "text", "code"] | None = None
    options: list[str] = Field(default_factory=list, max_length=50)
    text: str | None = Field(default=None, max_length=20_000)
    code: str | None = Field(default=None, max_length=100_000)
    language: str | None = Field(default=None, max_length=40)
    confidence: float = Field(ge=0, le=1)
    reason: str = Field(default="", max_length=1_000)


def validate_structured_answer(question: NormalizedQuestion, payload: dict[str, Any]) -> StructuredLLMAnswer:
    parsed = StructuredLLMAnswer.model_validate(payload)
    if parsed.outcome == "uncertain":
        return parsed
    if parsed.kind is None:
        raise ValueError("A solved response requires an answer kind")
    if question.question_type in {QuestionType.multiple_choice, QuestionType.multiple_select}:
        if parsed.kind != "options" or not parsed.options:
            raise ValueError("Choice questions require at least one option value")
        allowed = {option.value for option in question.options}
        unknown = set(parsed.options) - allowed
        if unknown:
            raise ValueError("Model returned an option that was not present in the question")
        if question.question_type == QuestionType.multiple_choice and len(parsed.options) != 1:
            raise ValueError("Multiple-choice questions require exactly one selected option")
    elif question.question_type == QuestionType.programming:
        if parsed.kind != "code" or not parsed.code:
            raise ValueError("Programming questions require code")
    elif parsed.kind != "text" or not parsed.text:
        raise ValueError("Text and mathematical questions require a text answer")
    return parsed


class LLMSolver(Solver):
    def __init__(
        self,
        *,
        api_key: str | None,
        base_url: str,
        model: str,
        timeout_seconds: float = 30,
        max_retries: int = 2,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self.transport = transport

    async def solve(self, question: NormalizedQuestion, context: dict[str, Any] | None = None) -> SolverResult:
        started = time.perf_counter()
        if not self.api_key:
            return SolverResult(
                status=SolverStatus.error,
                method="llm",
                provider="openai-compatible",
                model=self.model,
                duration_ms=(time.perf_counter() - started) * 1000,
                error="LLM provider is selected but QUIZPILOT_LLM_API_KEY is not configured",
            )
        context = context or {}
        model = str(context.get("model") or self.model)
        max_retries = int(context.get("max_retries", self.max_retries))
        prompt = self._build_prompt(question)
        last_error = "Provider did not return a response"
        validation_status = "not_applicable"

        async with httpx.AsyncClient(transport=self.transport, timeout=self.timeout_seconds) as client:
            for attempt in range(max_retries + 1):
                try:
                    response = await client.post(
                        f"{self.base_url}/chat/completions",
                        headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                        json={
                            "model": model,
                            "temperature": 0,
                            "response_format": {"type": "json_object"},
                            "messages": [
                                {"role": "system", "content": "You solve authorized software-QA quiz fixtures. Return only the requested JSON. If unsure, use outcome=uncertain; never guess."},
                                {"role": "user", "content": prompt},
                            ],
                        },
                    )
                    if response.status_code in {429, 500, 502, 503, 504}:
                        raise httpx.HTTPStatusError("Retryable provider status", request=response.request, response=response)
                    response.raise_for_status()
                    body = response.json()
                    content = body["choices"][0]["message"]["content"]
                    parsed = validate_structured_answer(question, json.loads(content))
                    validation_status = "valid"
                    duration = (time.perf_counter() - started) * 1000
                    if parsed.outcome == "uncertain":
                        return SolverResult(
                            status=SolverStatus.uncertain,
                            method="llm",
                            provider="openai-compatible",
                            model=model,
                            confidence=parsed.confidence,
                            duration_ms=duration,
                            validation_status=validation_status,
                            uncertainty_reason=parsed.reason or "Model returned uncertainty",
                            retry_count=attempt,
                        )
                    answer = ProposedAnswer(
                        kind=parsed.kind,
                        options=parsed.options,
                        text=parsed.text,
                        code=parsed.code,
                        language=parsed.language,
                    )
                    return SolverResult(
                        status=SolverStatus.solved,
                        answer=answer,
                        confidence=parsed.confidence,
                        method="llm",
                        provider="openai-compatible",
                        model=model,
                        duration_ms=duration,
                        validation_status=validation_status,
                        retry_count=attempt,
                    )
                except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPStatusError) as exc:
                    # Do not include request headers, API keys or response content in errors.
                    last_error = f"Provider request failed: {type(exc).__name__}"
                except (KeyError, IndexError, TypeError, json.JSONDecodeError, ValidationError, ValueError) as exc:
                    validation_status = "invalid"
                    last_error = f"Provider response validation failed: {type(exc).__name__}"
                if attempt < max_retries:
                    await asyncio.sleep(min(0.25 * (2**attempt), 1.0))

        return SolverResult(
            status=SolverStatus.error,
            method="llm",
            provider="openai-compatible",
            model=model,
            duration_ms=(time.perf_counter() - started) * 1000,
            validation_status=validation_status,
            error=last_error,
            retry_count=max_retries,
        )

    @staticmethod
    def _build_prompt(question: NormalizedQuestion) -> str:
        payload = {
            "task": "Solve this question. Use option values exactly as supplied.",
            "question_type": question.question_type,
            "question": question.text,
            "options": [option.model_dump() for option in question.options],
            "code_language": question.code_language,
            "response_schema": {
                "outcome": "solved or uncertain",
                "kind": "options, text, or code (required when solved)",
                "options": ["exact option values"],
                "text": "text answer or null",
                "code": "source code or null",
                "language": "language or null",
                "confidence": "number from 0 to 1",
                "reason": "short explanation or uncertainty reason",
            },
        }
        return json.dumps(payload)
