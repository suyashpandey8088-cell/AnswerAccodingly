import asyncio
import json

import httpx
import pytest

from app.schemas.domain import SolverStatus
from app.solvers.deterministic import DeterministicSolver, evaluate_arithmetic
from app.solvers.engine import SolverEngine
from app.solvers.llm import LLMSolver, validate_structured_answer
from tests.helpers import make_question


@pytest.mark.asyncio
async def test_deterministic_multiple_choice():
    result = await DeterministicSolver().solve(make_question())
    assert result.status == SolverStatus.solved
    assert result.answer.options == ["404"]
    assert result.validation_status == "valid"


@pytest.mark.asyncio
async def test_deterministic_multi_select_math_logic_text_and_code():
    primes = await DeterministicSolver().solve(make_question("Select all prime numbers.", "multiple_select", ("1", "2", "3", "4", "5")))
    assert primes.answer.options == ["2", "3", "5"]
    arithmetic = await DeterministicSolver().solve(make_question("Calculate 12 × 3 - 6.", "math", ()))
    assert arithmetic.answer.text == "30"
    sequence = await DeterministicSolver().solve(make_question("What comes next in the sequence 2, 4, 8, 16?", "logical", ("18", "24", "32", "64")))
    assert sequence.answer.options == ["32"]
    capital = await DeterministicSolver().solve(make_question("What is the capital of France?", "text", ()))
    assert capital.answer.text == "Paris"
    code = await DeterministicSolver().solve(make_question("Write a Python function named add(a, b) that returns their sum.", "programming", ()))
    assert code.answer.kind == "code"
    assert "return a + b" in code.answer.code


@pytest.mark.asyncio
async def test_no_reliable_solution_returns_uncertainty_not_default_answer():
    result = await DeterministicSolver().solve(make_question("Who wrote an obscure unpublished poem?", "text", ()))
    assert result.status == SolverStatus.uncertain
    assert result.answer is None


def test_arithmetic_rejects_executable_python():
    with pytest.raises(ValueError):
        evaluate_arithmetic("__import__('os').system('echo unsafe')")
    assert evaluate_arithmetic("(12 + 3) * 2") == 30


def test_structured_llm_response_validation():
    question = make_question()
    valid = validate_structured_answer(question, {"outcome": "solved", "kind": "options", "options": ["404"], "confidence": 0.8})
    assert valid.options == ["404"]
    with pytest.raises(ValueError, match="not present"):
        validate_structured_answer(question, {"outcome": "solved", "kind": "options", "options": ["invented"], "confidence": 0.8})


@pytest.mark.asyncio
async def test_llm_mocked_provider_and_malformed_response():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer secret-test-key"
        payload = {"choices": [{"message": {"content": json.dumps({"outcome": "solved", "kind": "options", "options": ["404"], "confidence": 0.9})}}]}
        return httpx.Response(200, json=payload)

    solver = LLMSolver(api_key="secret-test-key", base_url="https://provider.test/v1", model="test-model", transport=httpx.MockTransport(handler))
    result = await solver.solve(make_question())
    assert result.status == SolverStatus.solved
    assert result.answer.options == ["404"]
    assert result.provider == "openai-compatible"

    malformed = LLMSolver(
        api_key="secret-test-key",
        base_url="https://provider.test/v1",
        model="test-model",
        max_retries=0,
        transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={"choices": [{"message": {"content": "not-json"}}]})),
    )
    failed = await malformed.solve(make_question())
    assert failed.status == SolverStatus.error
    assert failed.validation_status == "invalid"
    assert "secret-test-key" not in failed.error


@pytest.mark.asyncio
async def test_solver_timeout():
    class SlowSolver:
        async def solve(self, question, context=None):
            await asyncio.sleep(1)

    engine = SolverEngine(SlowSolver())
    result = await engine.solve(make_question(), {"timeout_seconds": 0.01})
    assert result.status == SolverStatus.timeout
    assert result.answer is None


@pytest.mark.asyncio
async def test_missing_llm_key_is_explicit_error():
    result = await LLMSolver(api_key=None, base_url="https://provider.test", model="test").solve(make_question("Unsolvable", "text", ()))
    assert result.status == SolverStatus.error
    assert "API_KEY" in result.error
