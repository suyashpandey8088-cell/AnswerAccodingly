from __future__ import annotations

import ast
import operator
import re
import time
from typing import Any

from ..schemas.domain import NormalizedQuestion, ProposedAnswer, QuestionType, SolverResult, SolverStatus
from .base import Solver


_BINARY_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
}
_UNARY_OPERATORS = {ast.UAdd: operator.pos, ast.USub: operator.neg}


def evaluate_arithmetic(expression: str) -> int | float:
    """Evaluate only numeric arithmetic; names, calls and attributes are rejected."""
    tree = ast.parse(expression, mode="eval")

    def visit(node: ast.AST) -> int | float:
        if isinstance(node, ast.Expression):
            return visit(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in _BINARY_OPERATORS:
            left, right = visit(node.left), visit(node.right)
            if abs(left) > 1e12 or abs(right) > 1e12:
                raise ValueError("Arithmetic operand is too large")
            return _BINARY_OPERATORS[type(node.op)](left, right)
        if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPERATORS:
            return _UNARY_OPERATORS[type(node.op)](visit(node.operand))
        raise ValueError("Unsupported arithmetic expression")

    result = visit(tree)
    if abs(result) > 1e15:
        raise ValueError("Arithmetic result is too large")
    return result


def _number_text(value: int | float) -> str:
    return str(int(value)) if isinstance(value, float) and value.is_integer() else str(value)


def _extract_expression(text: str) -> str | None:
    cleaned = text.replace("×", "*").replace("÷", "/").replace("−", "-")
    cleaned = re.sub(r"(?<=\d)\s*[xX]\s*(?=\d)", "*", cleaned)
    candidates = re.findall(r"(?<![\w.])(?:\d+(?:\.\d+)?|\d*\.\d+)(?:\s*(?:\+|\-|\*|/|%|//)\s*(?:\d+(?:\.\d+)?|\d*\.\d+|\([^)]*\)))+", cleaned)
    if not candidates:
        # Parenthesized expressions and simple trailing expressions.
        match = re.search(r"(?:calculate|what is)\s+([^?.]+)", cleaned, re.IGNORECASE)
        if match and re.search(r"[+*/%-]|\d\s*\d", match.group(1)):
            candidates = [match.group(1)]
    for candidate in candidates:
        candidate = candidate.strip().rstrip("= ")
        if re.fullmatch(r"[\d\s()+*/%.-]+", candidate) and re.search(r"[+*/%-]", candidate):
            return candidate
    return None


def _option_for_value(question: NormalizedQuestion, value: str) -> str | None:
    normalized = value.strip().casefold()
    for option in question.options:
        if option.value.strip().casefold() == normalized or option.label.strip().casefold() == normalized:
            return option.value
    return None


def _is_prime(value: int) -> bool:
    if value < 2:
        return False
    if value == 2:
        return True
    if value % 2 == 0:
        return False
    return all(value % divisor for divisor in range(3, int(value**0.5) + 1, 2))


class DeterministicSolver(Solver):
    """Small, explainable solvers used by the local demo and simple QA fixtures."""

    async def solve(self, question: NormalizedQuestion, context: dict[str, Any] | None = None) -> SolverResult:
        started = time.perf_counter()
        method = "deterministic"
        try:
            answer = self._solve(question)
            duration = (time.perf_counter() - started) * 1000
            if answer is None:
                return SolverResult(
                    status=SolverStatus.uncertain,
                    method=method,
                    duration_ms=duration,
                    uncertainty_reason="No deterministic rule can reliably solve this question",
                )
            return SolverResult(
                status=SolverStatus.solved,
                answer=answer,
                confidence=0.99,
                method=method,
                duration_ms=duration,
                validation_status="valid",
            )
        except (ValueError, SyntaxError, ZeroDivisionError, OverflowError) as exc:
            return SolverResult(
                status=SolverStatus.error,
                method=method,
                duration_ms=(time.perf_counter() - started) * 1000,
                validation_status="invalid",
                error=f"Deterministic solver rejected the input: {exc}",
            )

    def _solve(self, question: NormalizedQuestion) -> ProposedAnswer | None:
        text = question.text.strip()
        lowered = text.casefold()

        if question.question_type == QuestionType.programming or "write a python function" in lowered:
            if re.search(r"\badd\s*\(\s*a\s*,\s*b\s*\)", lowered) or "function named add" in lowered:
                return ProposedAnswer(
                    kind="code",
                    language="python",
                    code="def add(a, b):\n    return a + b\n",
                )
            if "function named multiply" in lowered:
                return ProposedAnswer(
                    kind="code",
                    language="python",
                    code="def multiply(a, b):\n    return a * b\n",
                )
            return None

        if "select all prime" in lowered:
            primes = []
            for option in question.options:
                match = re.search(r"-?\d+", option.value)
                if match and _is_prime(int(match.group(0))):
                    primes.append(option.value)
            return ProposedAnswer(kind="options", options=primes) if primes else None

        if "http status" in lowered and "not found" in lowered:
            value = _option_for_value(question, "404")
            return ProposedAnswer(kind="options", options=[value]) if value else None

        if "capital of france" in lowered:
            value = _option_for_value(question, "Paris")
            return ProposedAnswer(kind="options", options=[value]) if value else ProposedAnswer(kind="text", text="Paris")

        if "next in the sequence" in lowered:
            numbers = [int(value) for value in re.findall(r"(?<![?])\b\d+\b", text.split("?")[0])]
            if len(numbers) >= 3:
                if all(numbers[index] - numbers[index - 1] == numbers[1] - numbers[0] for index in range(2, len(numbers))):
                    answer = numbers[-1] + (numbers[1] - numbers[0])
                elif numbers[0] != 0 and all(numbers[index - 1] != 0 and numbers[index] / numbers[index - 1] == numbers[1] / numbers[0] for index in range(2, len(numbers))):
                    answer = int(numbers[-1] * (numbers[1] / numbers[0]))
                else:
                    return None
                value = _option_for_value(question, str(answer))
                return ProposedAnswer(kind="options", options=[value]) if value else ProposedAnswer(kind="text", text=str(answer))

        expression = _extract_expression(text)
        if expression:
            answer = _number_text(evaluate_arithmetic(expression))
            value = _option_for_value(question, answer)
            if question.question_type in {QuestionType.multiple_choice, QuestionType.multiple_select} or question.options:
                return ProposedAnswer(kind="options", options=[value]) if value else None
            return ProposedAnswer(kind="text", text=answer)
        return None
