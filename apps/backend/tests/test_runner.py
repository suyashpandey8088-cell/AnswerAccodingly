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


def create_run(repository):
    config = ProjectCreate.model_validate(project_payload())
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
