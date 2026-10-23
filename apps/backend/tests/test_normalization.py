import pytest

from app.schemas.domain import AdapterType, QuestionType, TimerStatus
from app.services.normalization import classify_question, normalize_question, parse_timer


@pytest.mark.parametrize(
    ("raw", "seconds"),
    [("90", 90), ("01:30", 90), ("00:01:30", 90), ("Time remaining: 02:05", 125), ("1:59:59", 7199)],
)
def test_timer_formats(raw, seconds):
    timer = parse_timer(raw)
    assert timer.status == TimerStatus.present
    assert timer.seconds == seconds
    assert timer.raw_text == raw


def test_timer_states_never_turn_unreadable_text_into_zero():
    assert parse_timer(None).status == TimerStatus.absent
    assert parse_timer("not readable").status == TimerStatus.failed
    assert parse_timer("01:99").status == TimerStatus.failed
    uncertain = parse_timer("01:30", method="ocr", confidence=0.42)
    assert uncertain.status == TimerStatus.uncertain
    assert uncertain.seconds == 90
    assert uncertain.seconds != 0


def test_normalization_builds_shared_model():
    question = normalize_question(
        {
            "question_id": "q1",
            "text": "  Select all prime numbers.  ",
            "options": [{"label": "2", "value": "2"}, {"label": "4", "value": "4"}],
            "timer": "90",
        },
        source_adapter=AdapterType.browser,
        extraction_duration_ms=12.5,
    )
    assert question.text == "Select all prime numbers."
    assert question.question_type == QuestionType.multiple_select
    assert question.timer.seconds == 90
    assert question.extraction_duration_ms == 12.5


def test_incomplete_choice_extraction_is_rejected():
    with pytest.raises(ValueError, match="no answer options"):
        normalize_question(
            {"text": "Choose one", "question_type": "multiple_choice", "options": [], "timer": None},
            source_adapter=AdapterType.browser,
            extraction_duration_ms=1,
        )


def test_classification_does_not_guess_choice_for_code():
    assert classify_question("Write a function named add(a, b)") == QuestionType.programming
    assert classify_question("What comes next in the sequence 2, 4, 8?") == QuestionType.logical
