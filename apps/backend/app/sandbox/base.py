from abc import ABC, abstractmethod
from typing import Any, Literal

from pydantic import BaseModel, Field


class TestCase(BaseModel):
    args: list[Any] = Field(default_factory=list)
    kwargs: dict[str, Any] = Field(default_factory=dict)
    expected: Any = None


class SandboxResult(BaseModel):
    status: Literal["passed", "failed", "unsupported", "timeout", "error"]
    passed_tests: int = 0
    total_tests: int = 0
    stdout: str = ""
    stderr: str = ""
    details: str | None = None


class SandboxExecutor(ABC):
    @abstractmethod
    async def execute(
        self,
        *,
        code: str,
        language: str,
        function_name: str,
        test_cases: list[TestCase],
    ) -> SandboxResult:
        raise NotImplementedError
