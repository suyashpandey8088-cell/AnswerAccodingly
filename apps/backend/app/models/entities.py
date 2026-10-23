import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    adapter_type: Mapped[str] = mapped_column(String(20), nullable=False)
    target_config: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    selector_config: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False, default=dict)
    timeout_settings: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    solver_settings: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    safety_settings: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    question_types: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    runs: Mapped[list["TestRun"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class TestRun(Base):
    __tablename__ = "test_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False, index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    config_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    summary_metrics: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    error_summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    project: Mapped[Project] = relationship(back_populates="runs")
    question_results: Mapped[list["QuestionResult"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="QuestionResult.sequence"
    )


class QuestionResult(Base):
    __tablename__ = "question_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("test_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    question_identifier: Mapped[str | None] = mapped_column(String(300), nullable=True)
    question_type: Mapped[str] = mapped_column(String(40), default="unknown", nullable=False)
    extraction_result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    timer_data: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    proposed_answer: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    solver_result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    solver_method: Mapped[str | None] = mapped_column(String(100), nullable=True)
    verification_result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    final_status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False, index=True)
    failure_category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    stage_timings: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    error_details: Mapped[str | None] = mapped_column(Text, nullable=True)
    diagnostic_refs: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    run: Mapped[TestRun] = relationship(back_populates="question_results")
    assertions: Mapped[list["AssertionResult"]] = relationship(
        back_populates="question_result", cascade="all, delete-orphan", order_by="AssertionResult.id"
    )


class AssertionResult(Base):
    __tablename__ = "assertion_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_result_id: Mapped[int] = mapped_column(
        ForeignKey("question_results.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    expected_value: Mapped[Any] = mapped_column(JSON, nullable=True)
    actual_value: Mapped[Any] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False, default="")

    question_result: Mapped[QuestionResult] = relationship(back_populates="assertions")
