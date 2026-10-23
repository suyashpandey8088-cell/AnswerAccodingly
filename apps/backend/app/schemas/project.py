from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .domain import AdapterType, QuestionType


DEFAULT_SELECTORS: dict[str, str] = {
    "question_root": '[data-qa="question-screen"]',
    "question": '[data-qa="question"]',
    "options": '[data-qa="option"]',
    "timer": '[data-qa="timer"]',
    "text_answer": '[data-qa="text-answer"]',
    "code_answer": '[data-qa="code-answer"]',
    "submit": '[data-qa="submit"]',
    "next": '[data-qa="next"]',
    "feedback": '[data-qa="feedback"]',
    "complete": '[data-qa="quiz-complete"]',
}


class TimeoutSettings(BaseModel):
    operation_ms: int = Field(default=10_000, ge=250, le=120_000)
    feedback_ms: int = Field(default=5_000, ge=250, le=120_000)
    run_seconds: int = Field(default=300, ge=5, le=7_200)


class SolverSettings(BaseModel):
    provider: str = Field(default="deterministic", pattern="^(deterministic|llm)$")
    model: str | None = Field(default=None, max_length=200)
    timeout_seconds: float = Field(default=30, gt=0, le=120)
    max_retries: int = Field(default=2, ge=0, le=5)
    use_sandbox: bool = True


class SafetySettings(BaseModel):
    allow_submit: bool = False
    operator_confirmed: bool = False
    max_questions: int = Field(default=10, ge=1, le=100)
    failure_threshold: int = Field(default=5, ge=1, le=100)
    diagnostic_capture: bool = False


class TargetConfig(BaseModel):
    url: str | None = Field(default=None, max_length=2_048)
    application_name: str | None = Field(default=None, max_length=300)
    window_title: str | None = Field(default=None, max_length=300)
    oracle_profile: str | None = Field(default=None, max_length=100)
    demo_scenario: str = Field(default="normal", pattern="^(normal|delayed|incorrect_feedback|missing_element|timeout)$")
    headless: bool = False
    question_type: str | None = Field(default=None, max_length=40)
    code_language: str | None = Field(default=None, max_length=40)
    regions: dict[str, dict[str, int]] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_regions(self) -> "TargetConfig":
        for name, region in self.regions.items():
            if not {"x", "y", "width", "height"}.issubset(region):
                raise ValueError(f"Region {name!r} requires x, y, width and height")
            if region["width"] <= 0 or region["height"] <= 0:
                raise ValueError(f"Region {name!r} must have positive dimensions")
            if region["x"] < 0 or region["y"] < 0:
                raise ValueError(f"Region {name!r} coordinates cannot be negative")
        return self


class ProjectBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    adapter_type: AdapterType = AdapterType.browser
    target_config: TargetConfig
    selector_config: dict[str, str] = Field(default_factory=lambda: DEFAULT_SELECTORS.copy())
    timeout_settings: TimeoutSettings = Field(default_factory=TimeoutSettings)
    solver_settings: SolverSettings = Field(default_factory=SolverSettings)
    safety_settings: SafetySettings = Field(default_factory=SafetySettings)
    question_types: list[QuestionType] = Field(default_factory=lambda: [
        QuestionType.multiple_choice,
        QuestionType.multiple_select,
        QuestionType.math,
        QuestionType.logical,
        QuestionType.text,
        QuestionType.programming,
    ])

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Project name is required")
        return value

    @model_validator(mode="after")
    def validate_target(self) -> "ProjectBase":
        if self.adapter_type == AdapterType.browser:
            if not self.target_config.url:
                raise ValueError("A browser project requires an authorized target URL")
            missing_selectors = set(DEFAULT_SELECTORS) - set(self.selector_config)
            if missing_selectors:
                raise ValueError(f"Browser selector configuration is missing: {', '.join(sorted(missing_selectors))}")
        if self.adapter_type == AdapterType.desktop:
            if not (self.target_config.application_name or self.target_config.window_title):
                raise ValueError("A desktop project requires an application name or window title")
            required = {"question", "answer", "submit"}
            if not required.issubset(self.target_config.regions):
                raise ValueError("Desktop projects require calibrated question, answer and submit regions")
        return self


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    adapter_type: AdapterType | None = None
    target_config: TargetConfig | None = None
    selector_config: dict[str, str] | None = None
    timeout_settings: TimeoutSettings | None = None
    solver_settings: SolverSettings | None = None
    safety_settings: SafetySettings | None = None
    question_types: list[QuestionType] | None = None


class ProjectRead(ProjectBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    updated_at: datetime
    last_run_at: datetime | None = None
    last_run_status: str | None = None


class ProjectList(BaseModel):
    items: list[ProjectRead]
    total: int
    limit: int
    offset: int


def project_to_schema(project: Any, last_run: Any = None) -> ProjectRead:
    def aware(value: datetime | None) -> datetime | None:
        return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value

    return ProjectRead(
        id=project.id,
        name=project.name,
        adapter_type=project.adapter_type,
        target_config=project.target_config,
        selector_config=project.selector_config,
        timeout_settings=project.timeout_settings,
        solver_settings=project.solver_settings,
        safety_settings=project.safety_settings,
        question_types=project.question_types,
        created_at=aware(project.created_at),
        updated_at=aware(project.updated_at),
        last_run_at=aware(getattr(last_run, "started_at", None)),
        last_run_status=getattr(last_run, "status", None),
    )
