from __future__ import annotations

from typing import Any

from ..schemas.domain import (
    AssertionOutcome,
    AssertionStatus,
    InteractionResult,
    NormalizedQuestion,
    SolverResult,
    SolverStatus,
    TimerStatus,
    VerificationObservation,
)
from .oracles import answers_equal


def _interaction_assertion(name: str, result: InteractionResult, explanation: str) -> AssertionOutcome:
    if not result.success:
        status = AssertionStatus.failed
    elif result.verified is True:
        status = AssertionStatus.passed
    elif result.verified is False:
        status = AssertionStatus.failed
    else:
        status = AssertionStatus.unknown
    return AssertionOutcome(
        name=name,
        expected="Expected UI state observed",
        actual=result.actual,
        status=status,
        explanation=explanation if status == AssertionStatus.passed else result.error or "The resulting UI state could not be established",
    )


def verify_question(
    *,
    question: NormalizedQuestion,
    solver: SolverResult,
    selection: InteractionResult | None,
    submission: InteractionResult | None,
    observation: VerificationObservation | None,
    oracle: dict[str, Any] | None,
) -> list[AssertionOutcome]:
    assertions = [
        AssertionOutcome(
            name="question_displayed",
            expected="Non-empty normalized question",
            actual=question.question_id or question.text[:120],
            status=AssertionStatus.passed,
            explanation="The configured question element was extracted and normalized",
        )
    ]
    if oracle and oracle.get("option_count") is not None:
        expected_count = int(oracle["option_count"])
        actual_count = len(question.options)
        assertions.append(
            AssertionOutcome(
                name="option_count",
                expected=expected_count,
                actual=actual_count,
                status=AssertionStatus.passed if expected_count == actual_count else AssertionStatus.failed,
                explanation="Compared the visible option count with the independent demo fixture specification",
            )
        )
    if question.timer.status != TimerStatus.absent:
        timer_passed = question.timer.status == TimerStatus.present and question.timer.seconds is not None
        assertions.append(
            AssertionOutcome(
                name="timer_parsed",
                expected="Supported, certain timer value",
                actual=question.timer.model_dump(mode="json"),
                status=AssertionStatus.passed if timer_passed else AssertionStatus.unknown if question.timer.status == TimerStatus.uncertain else AssertionStatus.failed,
                explanation=question.timer.error or "Timer text was parsed without treating unreadable input as zero",
            )
        )
    assertions.append(
        AssertionOutcome(
            name="solver_output_valid",
            expected="Schema-valid answer or explicit uncertainty",
            actual={"status": solver.status, "method": solver.method},
            status=AssertionStatus.passed if solver.status == SolverStatus.solved else AssertionStatus.unknown if solver.status == SolverStatus.uncertain else AssertionStatus.failed,
            explanation=solver.error or solver.uncertainty_reason or "Solver output passed format validation",
        )
    )
    if selection is not None:
        assertions.append(_interaction_assertion("answer_selected", selection, "The intended answer was observed in the target UI"))
    if submission is not None:
        assertions.append(_interaction_assertion("submission_completed", submission, "A submission state transition was observed"))
    if observation is not None:
        assertions.append(
            AssertionOutcome(
                name="feedback_visible",
                expected="Feedback visible before the deadline",
                actual={"visible": observation.feedback_visible, "outcome": observation.outcome},
                status=AssertionStatus.passed if observation.feedback_visible else AssertionStatus.failed,
                explanation=observation.error or "Feedback was observed; its text alone is not an independent correctness oracle",
            )
        )

    correctness: bool | None = None
    correctness_explanation = "No independent correctness oracle is configured"
    if question.question_type == "programming":
        if solver.sandbox_status == "passed":
            correctness = True
            correctness_explanation = "Generated code passed independent test cases inside the isolated sandbox"
        elif solver.sandbox_status in {"failed", "timeout", "error"}:
            correctness = False
            correctness_explanation = "Generated code did not pass the independent sandbox checks"
        elif solver.sandbox_status == "unsupported":
            correctness_explanation = "Code execution is unsupported or disabled; submission does not prove code correctness"
    elif oracle:
        correctness = answers_equal(solver.answer, oracle.get("expected_answer"))
        if correctness is True:
            correctness_explanation = "Proposed answer matched the independent oracle (which was not supplied to the solver)"
        elif correctness is False:
            correctness_explanation = "Proposed answer differed from the independent oracle"
    assertions.append(
        AssertionOutcome(
            name="independent_correctness",
            expected="Answer matches an independent oracle or configured tests",
            actual=correctness,
            status=AssertionStatus.unknown if correctness is None else AssertionStatus.passed if correctness else AssertionStatus.failed,
            explanation=correctness_explanation,
        )
    )
    if oracle and observation and observation.feedback_visible and observation.outcome != "unknown" and correctness is not None:
        application_says_correct = observation.outcome == "correct"
        consistent = application_says_correct == correctness
        assertions.append(
            AssertionOutcome(
                name="feedback_oracle_consistency",
                expected="Application feedback agrees with independent evidence",
                actual={"application_outcome": observation.outcome, "oracle_correct": correctness},
                status=AssertionStatus.passed if consistent else AssertionStatus.failed,
                explanation=(
                    "Application feedback agrees with independent evidence"
                    if consistent
                    else "Disagreement recorded for investigation; AI feedback alone was not used to infer a quiz defect"
                ),
            )
        )
    return assertions


def status_from_assertions(assertions: list[AssertionOutcome]) -> str:
    if any(item.status == AssertionStatus.failed for item in assertions):
        return "failed"
    if not assertions or any(item.status == AssertionStatus.unknown for item in assertions):
        return "unknown"
    return "passed"
