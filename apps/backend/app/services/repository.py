"""Repository boundary keeps SQLAlchemy out of adapters and solvers.

The same service-facing operations can later be implemented for PostgreSQL;
SQLite is only the default engine in database.py.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..database import SessionLocal
from ..metrics.calculations import calculate_summary
from ..models.entities import AssertionResult, Project, QuestionResult, TestRun, utcnow
from ..schemas.domain import AssertionOutcome, RunStatus, TestStatus
from ..schemas.project import ProjectCreate, project_to_schema
from ..schemas.run import QuestionResultRead, TestRunRead


def enum_value(value: Any) -> Any:
    return getattr(value, "value", value)


def aware_utc(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def run_to_schema(run: TestRun, project_name: str | None = None) -> TestRunRead:
    return TestRunRead(
        id=run.id,
        project_id=run.project_id,
        project_name=project_name or (run.project.name if run.project else None),
        status=run.status,
        started_at=aware_utc(run.started_at),
        ended_at=aware_utc(run.ended_at),
        config_snapshot=run.config_snapshot or {},
        summary_metrics=run.summary_metrics or {},
        error_summary=run.error_summary,
    )


def question_to_schema(question: QuestionResult) -> QuestionResultRead:
    return QuestionResultRead(
        id=question.id,
        run_id=question.run_id,
        sequence=question.sequence,
        question_identifier=question.question_identifier,
        question_type=question.question_type or "unknown",
        extraction_result=question.extraction_result,
        timer_data=question.timer_data,
        proposed_answer=question.proposed_answer,
        solver_result=question.solver_result,
        solver_method=question.solver_method,
        verification_result=question.verification_result,
        final_status=question.final_status,
        failure_category=question.failure_category,
        stage_timings=question.stage_timings or {},
        error_details=question.error_details,
        diagnostic_refs=question.diagnostic_refs or [],
        assertions=[
            AssertionOutcome(
                name=item.name,
                expected=item.expected_value,
                actual=item.actual_value,
                status=item.status,
                explanation=item.explanation,
            )
            for item in question.assertions
        ],
        created_at=aware_utc(question.created_at),
    )


class Repository:
    def create_project(self, data: ProjectCreate) -> Project:
        with SessionLocal() as session:
            project = Project(
                name=data.name,
                adapter_type=enum_value(data.adapter_type),
                target_config=data.target_config.model_dump(),
                selector_config=data.selector_config,
                timeout_settings=data.timeout_settings.model_dump(),
                solver_settings=data.solver_settings.model_dump(),
                safety_settings=data.safety_settings.model_dump(),
                question_types=[enum_value(value) for value in data.question_types],
            )
            session.add(project)
            session.commit()
            session.refresh(project)
            return project

    def list_projects(self, limit: int = 50, offset: int = 0) -> tuple[list[Project], int, dict[str, TestRun | None]]:
        with SessionLocal() as session:
            total = session.query(Project).count()
            projects = list(session.scalars(select(Project).order_by(Project.updated_at.desc()).limit(limit).offset(offset)))
            last_runs: dict[str, TestRun | None] = {}
            for project in projects:
                last_runs[project.id] = session.scalar(
                    select(TestRun).where(TestRun.project_id == project.id).order_by(TestRun.started_at.desc()).limit(1)
                )
            # Detached objects remain readable because expire_on_commit=False.
            return projects, total, last_runs

    def get_project(self, project_id: str) -> Project | None:
        with SessionLocal() as session:
            return session.get(Project, project_id)

    def update_project(self, project_id: str, data: ProjectCreate) -> Project | None:
        with SessionLocal() as session:
            project = session.get(Project, project_id)
            if not project:
                return None
            project.name = data.name
            project.adapter_type = enum_value(data.adapter_type)
            project.target_config = data.target_config.model_dump()
            project.selector_config = data.selector_config
            project.timeout_settings = data.timeout_settings.model_dump()
            project.solver_settings = data.solver_settings.model_dump()
            project.safety_settings = data.safety_settings.model_dump()
            project.question_types = [enum_value(value) for value in data.question_types]
            project.updated_at = utcnow()
            session.commit()
            session.refresh(project)
            return project

    def delete_project(self, project_id: str) -> bool:
        with SessionLocal() as session:
            project = session.get(Project, project_id)
            if not project:
                return False
            session.delete(project)
            session.commit()
            return True

    def create_run(self, project: Project, snapshot: dict[str, Any]) -> TestRun:
        with SessionLocal() as session:
            run = TestRun(project_id=project.id, status=RunStatus.pending.value, config_snapshot=snapshot)
            session.add(run)
            session.commit()
            session.refresh(run)
            return run

    def set_run_running(self, run_id: str) -> None:
        with SessionLocal() as session:
            run = session.get(TestRun, run_id)
            if run:
                run.status = RunStatus.running.value
                session.commit()

    def list_runs(self, limit: int = 50, offset: int = 0, project_id: str | None = None) -> tuple[list[TestRun], int]:
        with SessionLocal() as session:
            query = select(TestRun).options(selectinload(TestRun.project))
            count_query = session.query(TestRun)
            if project_id:
                query = query.where(TestRun.project_id == project_id)
                count_query = count_query.filter(TestRun.project_id == project_id)
            total = count_query.count()
            runs = list(session.scalars(query.order_by(TestRun.started_at.desc()).limit(limit).offset(offset)).unique())
            return runs, total

    def get_run(self, run_id: str, with_questions: bool = True) -> TestRun | None:
        with SessionLocal() as session:
            options = [selectinload(TestRun.project)]
            if with_questions:
                options.append(selectinload(TestRun.question_results).selectinload(QuestionResult.assertions))
            return session.scalar(select(TestRun).where(TestRun.id == run_id).options(*options))

    def save_question(
        self,
        run_id: str,
        sequence: int,
        values: dict[str, Any],
        assertions: list[AssertionOutcome],
    ) -> QuestionResult:
        with SessionLocal() as session:
            question = QuestionResult(run_id=run_id, sequence=sequence, **values)
            session.add(question)
            session.flush()
            question.assertions = [
                AssertionResult(
                    name=item.name,
                    expected_value=item.expected,
                    actual_value=item.actual,
                    status=enum_value(item.status),
                    explanation=item.explanation,
                )
                for item in assertions
            ]
            session.commit()
            loaded = session.scalar(
                select(QuestionResult)
                .where(QuestionResult.id == question.id)
                .options(selectinload(QuestionResult.assertions))
            )
            if loaded is None:
                raise RuntimeError("Failed to persist question result")
            return loaded

    def finish_run(self, run_id: str, status: RunStatus, error_summary: str | None = None) -> TestRun:
        with SessionLocal() as session:
            run = session.scalar(
                select(TestRun)
                .where(TestRun.id == run_id)
                .options(selectinload(TestRun.question_results).selectinload(QuestionResult.assertions), selectinload(TestRun.project))
            )
            if run is None:
                raise KeyError(run_id)
            run.status = enum_value(status)
            run.ended_at = datetime.now(timezone.utc)
            run.error_summary = error_summary
            session.flush()
            run.summary_metrics = calculate_summary(run, list(run.question_results))
            session.commit()
            session.refresh(run)
            return run

    def refresh_summary(self, run_id: str) -> dict[str, Any]:
        with SessionLocal() as session:
            run = session.scalar(
                select(TestRun)
                .where(TestRun.id == run_id)
                .options(selectinload(TestRun.question_results).selectinload(QuestionResult.assertions))
            )
            if run is None:
                raise KeyError(run_id)
            run.summary_metrics = calculate_summary(run, list(run.question_results))
            session.commit()
            return run.summary_metrics

    def recover_interrupted_runs(self) -> int:
        with SessionLocal() as session:
            runs = list(session.scalars(select(TestRun).where(TestRun.status.in_(["pending", "running"]))))
            for run in runs:
                run.status = RunStatus.error.value
                run.ended_at = datetime.now(timezone.utc)
                run.error_summary = "Backend stopped before the run completed; previously saved question results were retained."
            session.commit()
            return len(runs)
