import asyncio

import pytest

from app.adapters.base import QuizAdapter
from app.schemas.domain import InteractionResult, NavigationResult, VerificationObservation
from app.schemas.project import ProjectCreate
from app.services.events import EventHub
from app.services.normalization import parse_timer
from app.services.repository import Repository
from app.services.runner import RunManager
from app.services.target_policy import TargetPolicy
from app.solvers.deterministic import DeterministicSolver
from app.solvers.engine import SolverEngine
from tests.helpers import project_payload


class FakeBrowserAdapter(QuizAdapter):
    def __init__(self):
        self.closed = False
        self.selected = None

    async def start(self):
        return 4.25

    async def inspect(self):
        from app.adapters.base import RawExtraction

        return RawExtraction(
            question_id="demo-http-404",
            text="Which HTTP status code means Not Found?",
            question_type="multiple_choice",
            options=[{"label": value, "value": value} for value in ("200", "201", "404", "500")],
            timer=parse_timer("01:30"),
            metadata={"extraction_duration_ms": 8, "timer_parsing_ms": 0.2},
        )

    async def select_answer(self, answer):
        self.selected = answer
        return InteractionResult(success=True, verified=True, actual=answer.options, duration_ms=3)

    async def submit(self):
        return InteractionResult(success=True, verified=True, actual={"submitted_attribute": "true"}, duration_ms=2)

    async def wait_for_result(self):
        return VerificationObservation(feedback_visible=True, outcome="correct", text="Correct", duration_ms=5)

    async def next_question(self):
        return NavigationResult(success=True, has_next=False, duration_ms=1)

    async def close(self):
        self.closed = True


class HangingAdapter(FakeBrowserAdapter):
    def __init__(self):
        super().__init__()
        self.inspecting = asyncio.Event()

    async def inspect(self):
        self.inspecting.set()
        await asyncio.Event().wait()


def make_manager(settings):
    repository = Repository()
    events = EventHub()
    manager = RunManager(
        repository=repository,
        settings=settings,
        solver_engine=SolverEngine(DeterministicSolver()),
        target_policy=TargetPolicy(settings),
        events=events,
    )
    return repository, events, manager


def create_run(repository, payload=None):
    config = ProjectCreate.model_validate(payload or project_payload())
    project = repository.create_project(config)
    return repository.create_run(project, {"project": config.model_dump(mode="json")})


@pytest.mark.asyncio
async def test_complete_managed_cycle_persists_real_results(settings):
    repository, events, manager = make_manager(settings)
    adapter = FakeBrowserAdapter()
    manager._build_adapter = lambda _config: adapter
    run = create_run(repository)
    await manager.start_run(run.id)
    task = manager._tasks[run.id]
    await asyncio.wait_for(task, timeout=5)

    stored = repository.get_run(run.id)
    assert stored.status == "passed"
    assert adapter.closed
    assert adapter.selected.options == ["404"]
    assert len(stored.question_results) == 1
    question = stored.question_results[0]
    assert question.final_status == "passed"
    assert question.stage_timings["browser_startup_ms"] == 4.25
    assert question.stage_timings["total_question_ms"] > 0
    assert stored.summary_metrics["verified_correctness_rate"] == 1
    assert stored.summary_metrics["median_total_latency_ms"] > 0
    assert any(item.name == "independent_correctness" and item.status == "passed" for item in question.assertions)
    assert any(item.event == "question.progress" for item in events._history[run.id])
    assert any(item.event == "question.result" for item in events._history[run.id])


@pytest.mark.asyncio
async def test_cancellation_is_real_and_closes_adapter(settings):
    repository, _events, manager = make_manager(settings)
    adapter = HangingAdapter()
    manager._build_adapter = lambda _config: adapter
    run = create_run(repository)
    await manager.start_run(run.id)
    await asyncio.wait_for(adapter.inspecting.wait(), timeout=2)
    assert await manager.cancel_run(run.id)
    stored = repository.get_run(run.id)
    assert stored.status == "cancelled"
    assert adapter.closed
    assert stored.ended_at is not None


@pytest.mark.asyncio
async def test_autonomous_run_stops_unknown_at_question_limit(settings):
    class ContinuingAdapter(FakeBrowserAdapter):
        async def next_question(self):
            return NavigationResult(success=True, has_next=True, duration_ms=1)

    repository, _events, manager = make_manager(settings)
    adapter = ContinuingAdapter()
    manager._build_adapter = lambda _config: adapter
    payload = project_payload(safety_settings={
        "allow_submit": True,
        "operator_confirmed": True,
        "max_questions": 1,
        "failure_threshold": 3,
    })
    run = create_run(repository, payload)
    await manager.start_run(run.id)
    await asyncio.wait_for(manager._tasks[run.id], timeout=5)

    stored = repository.get_run(run.id)
    assert stored.status == "unknown"
    assert "Maximum question limit" in stored.error_summary
    assert len(stored.question_results) == 1


@pytest.mark.asyncio
async def test_desktop_autopilot_stops_when_question_does_not_change(settings):
    class ContinuingDesktopAdapter(FakeBrowserAdapter):
        async def next_question(self):
            return NavigationResult(success=True, has_next=True, duration_ms=1)

    repository, _events, manager = make_manager(settings)
    manager._build_adapter = lambda _config: ContinuingDesktopAdapter()
    regions = {
        "question": {"x": 10, "y": 10, "width": 300, "height": 100},
        "answer": {"x": 10, "y": 120, "width": 300, "height": 100},
        "submit": {"x": 10, "y": 230, "width": 100, "height": 40},
    }
    payload = project_payload(
        adapter_type="desktop",
        target_config={"application_name": "Owned quiz", "window_title": "Owned quiz", "regions": regions},
        safety_settings={"allow_submit": True, "operator_confirmed": True, "max_questions": 3, "failure_threshold": 3},
    )
    run = create_run(repository, payload)
    await manager.start_run(run.id)
    await asyncio.wait_for(manager._tasks[run.id], timeout=5)

    stored = repository.get_run(run.id)
    assert stored.status == "failed"
    assert len(stored.question_results) == 2
    assert "same desktop question" in stored.question_results[-1].error_details


@pytest.mark.asyncio
async def test_feedback_timeout_stops_without_speculative_navigation(settings):
    class TimeoutAdapter(FakeBrowserAdapter):
        def __init__(self):
            super().__init__()
            self.next_calls = 0

        async def wait_for_result(self):
            return VerificationObservation(
                feedback_visible=False,
                outcome="unknown",
                timed_out=True,
                duration_ms=5,
                error="No result before timeout",
            )

        async def next_question(self):
            self.next_calls += 1
            return NavigationResult(success=True, has_next=True, duration_ms=1)

    repository, _events, manager = make_manager(settings)
    adapter = TimeoutAdapter()
    manager._build_adapter = lambda _config: adapter
    run = create_run(repository)
    await manager.start_run(run.id)
    await asyncio.wait_for(manager._tasks[run.id], timeout=5)

    stored = repository.get_run(run.id)
    assert stored.status == "failed"
    assert len(stored.question_results) == 1
    assert stored.question_results[0].final_status == "timeout"
    assert adapter.next_calls == 0
