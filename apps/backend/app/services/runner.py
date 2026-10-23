from __future__ import annotations

import asyncio
import re
import time
from typing import Any

from ..adapters.base import AdapterError, QuizAdapter
from ..adapters.browser import BrowserAdapter
from ..adapters.desktop import DesktopAdapter
from ..config import Settings
from ..schemas.domain import (
    AdapterType,
    AssertionOutcome,
    AssertionStatus,
    NormalizedQuestion,
    RunStatus,
    SolverResult,
    SolverStatus,
    StageTimings,
    TestStatus,
)
from ..schemas.project import ProjectCreate
from ..schemas.run import TestRunRead
from ..solvers.engine import SolverEngine
from .events import EventHub
from .normalization import normalize_question
from .oracles import get_oracle
from .repository import Repository, question_to_schema, run_to_schema
from .target_policy import TargetPolicy
from .verification import status_from_assertions, verify_question


class RunManager:
    def __init__(
        self,
        *,
        repository: Repository,
        settings: Settings,
        solver_engine: SolverEngine,
        target_policy: TargetPolicy,
        events: EventHub,
    ) -> None:
        self.repository = repository
        self.settings = settings
        self.solver_engine = solver_engine
        self.target_policy = target_policy
        self.events = events
        self._tasks: dict[str, asyncio.Task[Any]] = {}
        self._adapters: dict[str, QuizAdapter] = {}
        self._semaphore = asyncio.Semaphore(settings.max_concurrent_runs)
        self._finished: set[str] = set()

    async def start_run(self, run_id: str) -> None:
        if run_id in self._tasks:
            raise ValueError("Run has already been started")
        self._finished.discard(run_id)
        task = asyncio.create_task(self._manage_run(run_id), name=f"quizpilot-run-{run_id}")
        self._tasks[run_id] = task
        task.add_done_callback(lambda _task, rid=run_id: self._tasks.pop(rid, None))

    async def cancel_run(self, run_id: str) -> bool:
        task = self._tasks.get(run_id)
        if not task or task.done():
            return False
        task.cancel()
        try:
            await asyncio.wait_for(asyncio.gather(task, return_exceptions=True), timeout=8)
        except asyncio.TimeoutError:
            return False
        return True

    async def shutdown(self) -> None:
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _manage_run(self, run_id: str) -> None:
        adapter: QuizAdapter | None = None
        try:
            async with self._semaphore:
                run = self.repository.get_run(run_id, with_questions=False)
                if not run:
                    return
                config = self._project_from_snapshot(run.config_snapshot)
                self.repository.set_run_running(run_id)
                self.events.publish(run_id, "run.started", {"run_id": run_id, "status": "running"})
                adapter = self._build_adapter(config)
                self._adapters[run_id] = adapter
                timeout = config.timeout_settings.run_seconds
                await asyncio.wait_for(self._execute_questions(run_id, config, adapter), timeout=timeout)
        except asyncio.CancelledError:
            await self._finish_once(run_id, RunStatus.cancelled, "Run cancelled by the operator", event="run.cancelled")
        except (asyncio.TimeoutError, TimeoutError):
            await self._finish_once(run_id, RunStatus.timeout, "Run exceeded its configured hard deadline", event="run.failed")
        except Exception as exc:
            await self._finish_once(run_id, RunStatus.error, self._clean_error(exc), event="run.failed")
        finally:
            if adapter:
                try:
                    await adapter.close()
                except Exception:
                    pass
            self._adapters.pop(run_id, None)

    async def _execute_questions(self, run_id: str, config: ProjectCreate, adapter: QuizAdapter) -> None:
        startup_ms = await adapter.start()
        statuses: list[str] = []
        max_questions = config.safety_settings.max_questions
        for sequence in range(1, max_questions + 1):
            question_started = time.perf_counter()
            question: NormalizedQuestion | None = None
            solver = SolverResult(status=SolverStatus.error, method="not_started", error="Solver did not run")
            selection = None
            submission = None
            observation = None
            assertions: list[AssertionOutcome] = []
            timings: dict[str, float] = {"browser_startup_ms": startup_ms} if sequence == 1 and config.adapter_type == AdapterType.browser else {}
            should_continue = False
            try:
                self._progress(run_id, sequence, "extracting", question)
                raw = await adapter.inspect()
                extraction_ms = float(raw.metadata.get("extraction_duration_ms", (time.perf_counter() - question_started) * 1000))
                timings["extraction_ms"] = extraction_ms
                if raw.metadata.get("ocr_ms") is not None:
                    timings["ocr_ms"] = float(raw.metadata["ocr_ms"])
                if raw.metadata.get("timer_parsing_ms") is not None:
                    timings["timer_parsing_ms"] = float(raw.metadata["timer_parsing_ms"])
                classification_started = time.perf_counter()
                question = normalize_question(
                    raw.model_dump(),
                    source_adapter=config.adapter_type,
                    extraction_duration_ms=extraction_ms,
                )
                timings["classification_ms"] = (time.perf_counter() - classification_started) * 1000
                self._progress(run_id, sequence, "solving", question)

                allowed_types = {getattr(value, "value", value) for value in config.question_types}
                if question.question_type not in allowed_types:
                    solver = SolverResult(
                        status=SolverStatus.uncertain,
                        method="type_filter",
                        uncertainty_reason=f"Question type {question.question_type!r} is not enabled for this project",
                    )
                elif config.adapter_type == AdapterType.desktop and question.extraction_confidence < 0.75:
                    solver = SolverResult(
                        status=SolverStatus.uncertain,
                        method="ocr_review",
                        confidence=question.extraction_confidence,
                        uncertainty_reason="Ambiguous OCR extraction requires operator confirmation before input",
                    )
                else:
                    oracle = get_oracle(config.target_config.oracle_profile, question.question_id)
                    solver_context = {
                        "provider": config.solver_settings.provider,
                        "model": config.solver_settings.model,
                        "timeout_seconds": config.solver_settings.timeout_seconds,
                        "max_retries": config.solver_settings.max_retries,
                        "use_sandbox": config.solver_settings.use_sandbox,
                    }
                    if oracle:
                        # Only test cases are shared for execution. Expected non-code answers
                        # stay in the verification service and are never given to a solver.
                        solver_context["coding_test_cases"] = oracle.get("coding_test_cases")
                        solver_context["coding_function_name"] = oracle.get("coding_function_name")
                    solver = await self.solver_engine.solve(question, solver_context)
                timings["solver_ms"] = solver.duration_ms
                if solver.method == "llm":
                    timings["ai_provider_ms"] = solver.duration_ms
                oracle = get_oracle(config.target_config.oracle_profile, question.question_id)

                if solver.status == SolverStatus.solved and solver.answer:
                    self._progress(run_id, sequence, "selecting", question)
                    selection = await adapter.select_answer(solver.answer)
                    timings["selection_ms"] = selection.duration_ms
                    if config.safety_settings.allow_submit:
                        self._progress(run_id, sequence, "submitting", question)
                        submission = await adapter.submit()
                        timings["submission_ms"] = submission.duration_ms
                        self._progress(run_id, sequence, "verifying", question)
                        observation = await adapter.wait_for_result()
                        timings["ui_response_ms"] = observation.duration_ms
                    should_continue = config.safety_settings.allow_submit

                verification_started = time.perf_counter()
                assertions = verify_question(
                    question=question,
                    solver=solver,
                    selection=selection,
                    submission=submission,
                    observation=observation,
                    oracle=oracle,
                )
                timings["verification_ms"] = (time.perf_counter() - verification_started) * 1000

                if should_continue:
                    self._progress(run_id, sequence, "navigating", question)
                    navigation = await adapter.next_question()
                    timings["navigation_ms"] = navigation.duration_ms
                    assertions.append(
                        AssertionOutcome(
                            name="navigation_or_completion",
                            expected="Next question loaded or quiz completion was visible",
                            actual={"has_next": navigation.has_next, "question_id": navigation.question_id},
                            status=AssertionStatus.passed if navigation.success else AssertionStatus.failed,
                            explanation=navigation.error or "The configured navigation transition was observed",
                        )
                    )
                    should_continue = navigation.has_next
                final_status = self._status_for_question(solver, observation, assertions)
            except Exception as exc:
                if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
                    final_status = TestStatus.timeout.value
                    category = "stage_timeout"
                else:
                    final_status = TestStatus.error.value
                    category = f"{getattr(exc, 'stage', 'run')}_error"
                assertions.append(
                    AssertionOutcome(
                        name=f"{getattr(exc, 'stage', 'run')}_completed",
                        expected="Stage completed without an adapter error",
                        actual=type(exc).__name__,
                        status=AssertionStatus.failed,
                        explanation=self._clean_error(exc),
                    )
                )
                solver.error = solver.error or self._clean_error(exc)
                solver.status = SolverStatus.error if final_status == TestStatus.error.value else SolverStatus.timeout
                timings["total_question_ms"] = (time.perf_counter() - question_started) * 1000
                await self._persist_question(
                    run_id, sequence, question, solver, selection, submission, observation,
                    assertions, timings, final_status, category, self._clean_error(exc),
                )
                statuses.append(final_status)
                break

            timings["total_question_ms"] = (time.perf_counter() - question_started) * 1000
            category = self._failure_category(final_status, observation, assertions, solver)
            error_details = solver.error or solver.uncertainty_reason
            await self._persist_question(
                run_id, sequence, question, solver, selection, submission, observation,
                assertions, timings, final_status, category, error_details,
            )
            statuses.append(final_status)
            failures = sum(status in {"failed", "timeout", "error"} for status in statuses)
            if failures >= config.safety_settings.failure_threshold:
                await self._finish_once(run_id, RunStatus.failed, "Configured failure threshold reached", event="run.failed")
                return
            if solver.status != SolverStatus.solved or not should_continue:
                break

        if any(status in {"failed", "timeout", "error"} for status in statuses):
            final_run_status = RunStatus.failed
        elif not statuses or any(status == "unknown" for status in statuses):
            final_run_status = RunStatus.unknown
        else:
            final_run_status = RunStatus.passed
        await self._finish_once(run_id, final_run_status, event="run.completed")

    async def _persist_question(
        self,
        run_id: str,
        sequence: int,
        question: NormalizedQuestion | None,
        solver: SolverResult,
        selection: Any,
        submission: Any,
        observation: Any,
        assertions: list[AssertionOutcome],
        timings: dict[str, float],
        final_status: str,
        failure_category: str | None,
        error_details: str | None,
    ) -> None:
        stage_timings = StageTimings.model_validate(timings).model_dump(mode="json")
        values = {
            "question_identifier": question.question_id if question else None,
            "question_type": question.question_type if question else "unknown",
            "extraction_result": question.model_dump(mode="json") if question else None,
            "timer_data": question.timer.model_dump(mode="json") if question else None,
            "proposed_answer": solver.answer.model_dump(mode="json") if solver.answer else None,
            "solver_result": solver.model_dump(mode="json"),
            "solver_method": solver.method,
            "verification_result": {
                "selection": selection.model_dump(mode="json") if selection else None,
                "submission": submission.model_dump(mode="json") if submission else None,
                "observation": observation.model_dump(mode="json") if observation else None,
                "application_feedback_is_not_an_oracle": True,
            },
            "final_status": final_status,
            "failure_category": failure_category,
            "stage_timings": stage_timings,
            "error_details": self._clean_error(error_details) if error_details else None,
            "diagnostic_refs": question.diagnostic_refs if question else [],
        }
        saved = await asyncio.to_thread(self.repository.save_question, run_id, sequence, values, assertions)
        await asyncio.to_thread(self.repository.refresh_summary, run_id)
        self.events.publish(
            run_id,
            "question.result",
            {"sequence": sequence, "question": question_to_schema(saved).model_dump(mode="json")},
        )

    async def _finish_once(
        self,
        run_id: str,
        status: RunStatus,
        error_summary: str | None = None,
        *,
        event: str,
    ) -> None:
        if run_id in self._finished:
            return
        try:
            run = await asyncio.to_thread(self.repository.finish_run, run_id, status, error_summary)
            self._finished.add(run_id)
            schema = run_to_schema(run)
            self.events.publish(run_id, event, {"run": schema.model_dump(mode="json")})
        except KeyError:
            return

    def _build_adapter(self, config: ProjectCreate) -> QuizAdapter:
        if config.adapter_type == AdapterType.browser:
            return BrowserAdapter(
                target_url=config.target_config.url or "",
                selectors=config.selector_config,
                operation_timeout_ms=config.timeout_settings.operation_ms,
                feedback_timeout_ms=config.timeout_settings.feedback_ms,
                headless=config.target_config.headless,
                executable_path=self.settings.browser_executable_path,
                target_policy=self.target_policy,
            )
        return DesktopAdapter(
            target_config=config.target_config.model_dump(),
            operator_confirmed=config.safety_settings.operator_confirmed,
            operation_timeout_ms=config.timeout_settings.operation_ms,
            feedback_timeout_ms=config.timeout_settings.feedback_ms,
        )

    @staticmethod
    def _project_from_snapshot(snapshot: dict[str, Any]) -> ProjectCreate:
        return ProjectCreate.model_validate(snapshot["project"])

    def _progress(self, run_id: str, sequence: int, stage: str, question: NormalizedQuestion | None) -> None:
        self.events.publish(
            run_id,
            "question.progress",
            {
                "sequence": sequence,
                "stage": stage,
                "question_id": question.question_id if question else None,
                "question_text": question.text if question else None,
                "timer": question.timer.model_dump(mode="json") if question else None,
            },
        )

    @staticmethod
    def _status_for_question(solver: SolverResult, observation: Any, assertions: list[AssertionOutcome]) -> str:
        if solver.status == SolverStatus.timeout:
            return TestStatus.timeout.value
        if solver.status == SolverStatus.error:
            return TestStatus.error.value
        if observation and observation.timed_out:
            return TestStatus.timeout.value
        return status_from_assertions(assertions)

    @staticmethod
    def _failure_category(
        final_status: str,
        observation: Any,
        assertions: list[AssertionOutcome],
        solver: SolverResult,
    ) -> str | None:
        if final_status == "timeout":
            return "verification_timeout" if observation and observation.timed_out else "solver_timeout"
        if final_status == "error":
            return "solver_error" if solver.status == SolverStatus.error else "verification_error"
        if final_status == "failed":
            failed = next((item for item in assertions if item.status == AssertionStatus.failed), None)
            if failed:
                return {
                    "independent_correctness": "correctness",
                    "feedback_oracle_consistency": "feedback_disagreement",
                    "feedback_visible": "verification",
                    "option_count": "extraction_assertion",
                }.get(failed.name, failed.name)
            return "verification"
        return None

    @staticmethod
    def _clean_error(error: Any) -> str:
        text = " ".join(str(error).split())
        text = re.sub(r"(?i)(bearer|api[_-]?key|token)\s*[=:]\s*\S+", r"\1=[redacted]", text)
        return text[:1_500]
