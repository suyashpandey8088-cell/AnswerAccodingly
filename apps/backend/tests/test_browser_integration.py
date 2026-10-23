import asyncio
import socket

import pytest
import uvicorn

from app.adapters.base import ExtractionError
from app.adapters.browser import BrowserAdapter
from app.main import create_app
from app.schemas.project import DEFAULT_SELECTORS, ProjectCreate
from app.services.events import EventHub
from app.services.normalization import normalize_question
from app.services.oracles import get_oracle
from app.services.repository import Repository
from app.services.runner import RunManager
from app.services.target_policy import TargetPolicy
from app.services.verification import verify_question
from app.solvers.deterministic import DeterministicSolver
from app.solvers.engine import SolverEngine
from tests.helpers import project_payload


@pytest.fixture
async def demo_server(settings):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(create_app(settings), host="127.0.0.1", port=port, log_level="error"))
    task = asyncio.create_task(server.serve())
    for _ in range(100):
        if server.started:
            break
        await asyncio.sleep(0.05)
    else:
        task.cancel()
        pytest.fail("Demo server did not start")
    yield f"http://127.0.0.1:{port}/demo/"
    server.should_exit = True
    await asyncio.wait_for(task, timeout=5)


def make_adapter(settings, url, feedback_ms=2500):
    return BrowserAdapter(
        target_url=url,
        selectors=DEFAULT_SELECTORS.copy(),
        operation_timeout_ms=5000,
        feedback_timeout_ms=feedback_ms,
        headless=True,
        executable_path=settings.browser_executable_path,
        target_policy=TargetPolicy(settings),
    )


@pytest.mark.browser
@pytest.mark.asyncio
async def test_real_browser_extract_select_submit_verify_navigate_and_cleanup(settings, demo_server, browser_enabled):
    adapter = make_adapter(settings, demo_server)
    try:
        assert await adapter.start() > 0
        raw = await adapter.inspect()
        question = normalize_question(raw.model_dump(), source_adapter="browser", extraction_duration_ms=1)
        assert question.question_id == "demo-http-404"
        assert len(question.options) == 4
        assert question.timer.seconds == 90
        solver = await DeterministicSolver().solve(question)
        selection = await adapter.select_answer(solver.answer)
        assert selection.success and selection.verified
        submission = await adapter.submit()
        assert submission.success and submission.verified
        observation = await adapter.wait_for_result()
        assert observation.outcome == "correct"
        assertions = verify_question(
            question=question,
            solver=solver,
            selection=selection,
            submission=submission,
            observation=observation,
            oracle=get_oracle("demo-v1", question.question_id),
        )
        assert all(item.status != "failed" for item in assertions)
        assert any(item.name == "independent_correctness" and item.status == "passed" for item in assertions)
        navigation = await adapter.next_question()
        assert navigation.success and navigation.has_next
        assert navigation.question_id == "demo-primes"
    finally:
        await adapter.close()
    assert adapter.page is None
    assert adapter.browser is None
    assert adapter.context is None


@pytest.mark.browser
@pytest.mark.asyncio
async def test_real_browser_feedback_timeout_and_cleanup(settings, demo_server, browser_enabled):
    adapter = make_adapter(settings, f"{demo_server}?scenario=timeout", feedback_ms=300)
    try:
        await adapter.start()
        raw = await adapter.inspect()
        question = normalize_question(raw.model_dump(), source_adapter="browser", extraction_duration_ms=1)
        solver = await DeterministicSolver().solve(question)
        await adapter.select_answer(solver.answer)
        await adapter.submit()
        observation = await adapter.wait_for_result()
        assert observation.timed_out
        assert not observation.feedback_visible
    finally:
        await adapter.close()
    assert adapter.browser is None


@pytest.mark.browser
@pytest.mark.asyncio
async def test_real_browser_detects_missing_options(settings, demo_server, browser_enabled):
    adapter = make_adapter(settings, f"{demo_server}?scenario=missing_element")
    try:
        await adapter.start()
        # Complete the first question to reach the intentionally broken second question.
        raw = await adapter.inspect()
        question = normalize_question(raw.model_dump(), source_adapter="browser", extraction_duration_ms=1)
        solver = await DeterministicSolver().solve(question)
        await adapter.select_answer(solver.answer)
        await adapter.submit()
        await adapter.wait_for_result()
        await adapter.next_question()
        with pytest.raises(ExtractionError, match="missing its answer options"):
            await adapter.inspect()
    finally:
        await adapter.close()


@pytest.mark.browser
@pytest.mark.asyncio
async def test_full_real_demo_run_persists_all_question_types(settings, demo_server, browser_enabled):
    payload = project_payload()
    payload["target_config"]["url"] = demo_server
    payload["timeout_settings"]["feedback_ms"] = 3000
    config = ProjectCreate.model_validate(payload)
    repository = Repository()
    project = repository.create_project(config)
    run = repository.create_run(project, {"project": config.model_dump(mode="json")})
    manager = RunManager(
        repository=repository,
        settings=settings,
        solver_engine=SolverEngine(DeterministicSolver()),
        target_policy=TargetPolicy(settings),
        events=EventHub(),
    )
    await manager.start_run(run.id)
    await asyncio.wait_for(manager._tasks[run.id], timeout=30)

    stored = repository.get_run(run.id)
    assert stored.status == "unknown", [
        (q.question_identifier, q.final_status, q.error_details, [(a.name, a.status, a.explanation) for a in q.assertions])
        for q in stored.question_results
    ]  # Coding correctness is unsupported without the sandbox.
    assert len(stored.question_results) == 6
    assert [question.final_status for question in stored.question_results] == [
        "passed", "passed", "passed", "passed", "passed", "unknown"
    ]
    assert stored.summary_metrics["verified_correct_answers"] == 5
    assert stored.summary_metrics["verified_correctness_rate"] == 1
    assert stored.summary_metrics["unknown_questions"] == 1
    assert stored.summary_metrics["median_total_latency_ms"] > 0
    assert stored.summary_metrics["p95_total_latency_ms"] > 0
    code_result = stored.question_results[-1]
    assert code_result.solver_result["sandbox_status"] == "unsupported"
    correctness = next(item for item in code_result.assertions if item.name == "independent_correctness")
    assert correctness.status == "unknown"
