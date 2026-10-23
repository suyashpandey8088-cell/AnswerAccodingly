from __future__ import annotations

import asyncio
import re
import time
from typing import Any

from ..sandbox.base import SandboxExecutor, TestCase
from ..schemas.domain import NormalizedQuestion, QuestionType, SolverResult, SolverStatus
from .base import Solver
from .deterministic import DeterministicSolver


class SolverEngine(Solver):
    def __init__(self, deterministic: DeterministicSolver, llm: Solver | None = None, sandbox: SandboxExecutor | None = None) -> None:
        self.deterministic = deterministic
        self.llm = llm
        self.sandbox = sandbox

    async def solve(self, question: NormalizedQuestion, context: dict[str, Any] | None = None) -> SolverResult:
        context = context or {}
        timeout = float(context.get("timeout_seconds", 30))
        started = time.perf_counter()
        try:
            result = await asyncio.wait_for(self._solve(question, context), timeout=timeout)
        except asyncio.TimeoutError:
            return SolverResult(
                status=SolverStatus.timeout,
                method="solver_engine",
                duration_ms=(time.perf_counter() - started) * 1000,
                error=f"Solver exceeded its {timeout:g}s deadline",
            )
        return result

    async def _solve(self, question: NormalizedQuestion, context: dict[str, Any]) -> SolverResult:
        result = await self.deterministic.solve(question, context)
        if result.status == SolverStatus.uncertain and context.get("provider") == "llm" and self.llm:
            result = await self.llm.solve(question, context)
        if (
            result.status == SolverStatus.solved
            and question.question_type == QuestionType.programming
            and result.answer
            and result.answer.code
            and context.get("use_sandbox", True)
        ):
            if not self.sandbox:
                result.sandbox_status = "unsupported"
                result.sandbox_details = {"reason": "No sandbox executor is configured"}
            else:
                raw_cases = context.get("coding_test_cases") or []
                function_name = context.get("coding_function_name") or self._infer_function_name(question.text)
                if not raw_cases or not function_name:
                    result.sandbox_status = "unsupported"
                    result.sandbox_details = {"reason": "No independent coding test cases or function name are configured"}
                else:
                    sandbox_result = await self.sandbox.execute(
                        code=result.answer.code,
                        language=result.answer.language or question.code_language or "python",
                        function_name=function_name,
                        test_cases=[TestCase.model_validate(case) for case in raw_cases],
                    )
                    result.sandbox_status = sandbox_result.status
                    result.sandbox_details = sandbox_result.model_dump()
        return result

    @staticmethod
    def _infer_function_name(text: str) -> str | None:
        match = re.search(r"function\s+(?:named\s+)?[`'\"]?([A-Za-z_]\w*)", text, re.IGNORECASE)
        return match.group(1) if match else None
