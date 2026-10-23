from abc import ABC, abstractmethod
from typing import Any

from ..schemas.domain import NormalizedQuestion, SolverResult


class Solver(ABC):
    @abstractmethod
    async def solve(self, question: NormalizedQuestion, context: dict[str, Any] | None = None) -> SolverResult:
        """Validate, solve and validate again without interacting with a target UI."""
        raise NotImplementedError
