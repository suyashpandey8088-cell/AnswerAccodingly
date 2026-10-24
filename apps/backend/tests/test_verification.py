from app.schemas.domain import InteractionResult, SolverResult, VerificationObservation
from app.services.verification import status_from_assertions, verify_question
from tests.helpers import make_question


def solved():
    return SolverResult.model_validate({
        "status": "solved",
        "answer": {"kind": "options", "options": ["404"]},
        "confidence": 1,
        "method": "deterministic",
        "duration_ms": 1,
        "validation_status": "valid",
    })


def test_submission_without_oracle_is_unknown_not_verified_pass():
    question = make_question()
    assertions = verify_question(
        question=question,
        solver=solved(),
        selection=InteractionResult(success=True, verified=True, duration_ms=1),
        submission=InteractionResult(success=True, verified=True, duration_ms=1),
        observation=VerificationObservation(feedback_visible=True, outcome="correct", duration_ms=1),
        oracle=None,
    )
    correctness = next(item for item in assertions if item.name == "independent_correctness")
    assert correctness.status == "unknown"
    assert status_from_assertions(assertions) == "unknown"


def test_feedback_disagreement_requires_independent_oracle():
    question = make_question()
    oracle = {"expected_answer": {"kind": "options", "options": ["404"]}, "option_count": 4}
    assertions = verify_question(
        question=question,
        solver=solved(),
        selection=InteractionResult(success=True, verified=True, duration_ms=1),
        submission=InteractionResult(success=True, verified=True, duration_ms=1),
        observation=VerificationObservation(feedback_visible=True, outcome="incorrect", duration_ms=1),
        oracle=oracle,
    )
    disagreement = next(item for item in assertions if item.name == "feedback_oracle_consistency")
    assert disagreement.status == "failed"
    assert "AI feedback alone" in disagreement.explanation


def test_no_feedback_application_is_unknown_instead_of_failed():
    assertions = verify_question(
        question=make_question(),
        solver=solved(),
        selection=InteractionResult(success=True, verified=None, duration_ms=1),
        submission=InteractionResult(success=True, verified=None, duration_ms=1),
        observation=VerificationObservation(
            feedback_visible=False,
            feedback_required=False,
            outcome="unknown",
            duration_ms=1,
            error="The application advanced without answer feedback",
        ),
        oracle=None,
    )
    feedback = next(item for item in assertions if item.name == "feedback_visible")
    assert feedback.status == "unknown"
    assert status_from_assertions(assertions) == "unknown"
