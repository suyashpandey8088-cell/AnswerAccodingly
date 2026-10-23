from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .domain import (
    AssertionOutcome,
    NormalizedQuestion,
    ProposedAnswer,
    QuestionType,
    RunStatus,
    SolverResult,
    StageTimings,
    TestStatus,
    TimerData,
)


class RunCreate(BaseModel):
    project_id: str = Field(min_length=1, max_length=64)
    operator_confirmed: bool = False


class QuestionResultRead(BaseModel):
    id: int
    run_id: str
    sequence: int
    question_identifier: str | None
    question_type: QuestionType
    extraction_result: dict[str, Any] | None
    timer_data: TimerData | None
    proposed_answer: ProposedAnswer | None
    solver_result: SolverResult | None
    solver_method: str | None
    verification_result: dict[str, Any] | None
    final_status: TestStatus
    failure_category: str | None
    stage_timings: StageTimings
    error_details: str | None
    diagnostic_refs: list[str]
    assertions: list[AssertionOutcome] = Field(default_factory=list)
    created_at: datetime


class TestRunRead(BaseModel):
    id: str
    project_id: str
    project_name: str | None = None
    status: RunStatus
    started_at: datetime
    ended_at: datetime | None
    config_snapshot: dict[str, Any]
    summary_metrics: dict[str, Any]
    error_summary: str | None


class RunDetail(TestRunRead):
    question_results: list[QuestionResultRead] = Field(default_factory=list)


class RunList(BaseModel):
    items: list[TestRunRead]
    total: int
    limit: int
    offset: int


class RunEvent(BaseModel):
    event: str
    run_id: str
    sequence: int
    timestamp: datetime
    data: dict[str, Any]


class ReportSummary(BaseModel):
    total_questions: int
    executed_questions: int
    passed_questions: int
    failed_questions: int
    timeout_questions: int
    error_questions: int
    unknown_questions: int
    skipped_questions: int
    passed_assertions: int
    failed_assertions: int
    unknown_assertions: int
    assertions_with_pass_criteria: int
    verified_correct_answers: int
    correctness_eligible_answers: int
    pass_rate: float | None
    verified_correctness_rate: float | None
    timeout_rate: float | None
    median_total_latency_ms: float | None
    p95_total_latency_ms: float | None
    run_duration_ms: float | None
    failure_categories: dict[str, int]
    stage_latency: dict[str, dict[str, float | int | None]]


class RunReport(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    run: TestRunRead
    summary: ReportSummary
    questions: list[QuestionResultRead]


class ExportFormat(BaseModel):
    format: Literal["json", "csv"] = "json"
