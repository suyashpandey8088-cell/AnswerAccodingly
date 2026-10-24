from unittest.mock import AsyncMock

import pytest

from app.adapters.base import ExtractionError, InteractionError
from app.adapters.windows_live import WindowsLiveAdapter, classify_ocr_line
from app.adapters.windows_live_analysis import LiveControl, analyze_controls
from app.schemas.domain import ProposedAnswer
from app.schemas.project import ProjectCreate
from tests.helpers import project_payload


def control(text: str, control_type: str, y: int, key: str | None = None, **kwargs) -> LiveControl:
    return LiveControl(
        key=key or f"{control_type}-{text}",
        text=text,
        control_type=control_type,
        x=100,
        y=y,
        width=300,
        height=32,
        **kwargs,
    )


def uia_screen(question: str = "Which HTTP status code means Not Found?"):
    return analyze_controls([
        control("Owned quiz", "Text", 10),
        control("Time remaining 01:30", "Text", 35),
        control(question, "Text", 75),
        control("200", "RadioButton", 140, "option-200"),
        control("201", "RadioButton", 180, "option-201"),
        control("404", "RadioButton", 220, "option-404"),
        control("500", "RadioButton", 260, "option-500"),
        control("Submit", "Button", 320, "submit"),
    ], source="uia")


class FakeWindowProvider:
    def __init__(self):
        self.activations = 0

    async def validate_target(self, _application_name, _window_title):
        return None

    async def activate_target(self, _application_name, _window_title, _regions):
        self.activations += 1


def live_adapter(analysis, *, confirmed=True, feedback_timeout_ms=500):
    state = {"analysis": analysis}
    provider = FakeWindowProvider()
    adapter = WindowsLiveAdapter(
        target_config={"window_title": "Owned quiz", "capture_mode": "live", "regions": {}},
        operator_confirmed=confirmed,
        feedback_timeout_ms=feedback_timeout_ms,
        window_provider=provider,
        screen_reader=lambda: state["analysis"],
    )
    return adapter, provider, state


def test_uia_analysis_detects_question_options_submit_and_timer_without_regions():
    analysis = uia_screen()
    assert analysis.question_text == "Which HTTP status code means Not Found?"
    assert analysis.question_type == "multiple_choice"
    assert [option.text for option in analysis.options] == ["200", "201", "404", "500"]
    assert analysis.submit_control.text == "Submit"
    assert analysis.timer.seconds == 90
    assert analysis.confidence >= 0.75
    assert analysis.fingerprint


def test_uia_analysis_supports_multi_select_and_empty_text_input():
    multiple = analyze_controls([
        control("Select two correct answers", "Text", 20),
        control("Alpha", "CheckBox", 80),
        control("Beta", "CheckBox", 120),
        control("Submit", "Button", 180),
    ])
    assert multiple.question_type == "multiple_select"
    text = analyze_controls([
        control("Write a function that returns the sum of two numbers", "Text", 20),
        control("", "Edit", 90, "answer-editor"),
        control("Submit", "Button", 180),
    ])
    assert text.question_type == "programming"
    assert text.text_input.key == "answer-editor"
    assert not text.options
    ambiguous = analyze_controls([
        control("Explain both values", "Text", 20),
        control("", "Edit", 80, "first-editor"),
        control("", "Edit", 130, "second-editor"),
        control("Submit", "Button", 190),
    ])
    assert ambiguous.text_input is None
    assert ambiguous.metadata["input_control_count"] == 2


def test_ocr_analysis_combines_question_lines_and_reads_dynamic_options():
    analysis = analyze_controls([
        control("What is the output", "Text", 20, confidence=0.94),
        control("of this program?", "Text", 45, confidence=0.92),
        control("Alpha", "RadioButton", 110, confidence=0.91),
        control("Beta", "RadioButton", 145, confidence=0.90),
        control("Gamma", "RadioButton", 180, confidence=0.93),
        control("Submit", "Button", 240, confidence=0.96),
        control("Next", "Button", 280, confidence=0.95),
    ], source="ocr")
    assert analysis.question_text == "What is the output of this program?"
    assert [option.text for option in analysis.options] == ["Alpha", "Beta", "Gamma"]
    assert analysis.next_control.text == "Next"
    assert 0.75 <= analysis.confidence < 0.95


def test_ocr_line_classifier_distinguishes_numbered_questions_from_options():
    assert classify_ocr_line("1. What is 2 + 2?") == ("What is 2 + 2?", "Text")
    assert classify_ocr_line("A. 4") == ("4", "RadioButton")
    assert classify_ocr_line("2) Solve 2 + 2") == ("Solve 2 + 2", "Text")
    assert classify_ocr_line("Submit") == ("Submit", "Button")


def test_question_wording_is_not_misreported_as_feedback_or_completion():
    analysis = uia_screen("What is the correct answer and what is your score?")
    assert analysis.feedback_outcome == "unknown"
    assert not analysis.completion_visible


def test_option_labels_are_not_misread_as_feedback_or_timer():
    analysis = analyze_controls([
        control("Which wording is appropriate?", "Text", 20),
        control("Correct", "RadioButton", 80),
        control("Incorrect", "RadioButton", 120),
        control("01:30", "RadioButton", 160),
        control("Submit", "Button", 220),
    ])
    assert analysis.feedback_outcome == "unknown"
    assert analysis.timer.status == "absent"


def test_feedback_confidence_is_not_inherited_from_question():
    analysis = analyze_controls([
        control("Which value is correct?", "Text", 20, confidence=0.98),
        control("One", "RadioButton", 80, confidence=0.97),
        control("Two", "RadioButton", 120, confidence=0.96),
        control("Submit", "Button", 180, confidence=0.97),
        control("Correct!", "Text", 240, confidence=0.40),
    ], source="ocr")
    assert analysis.confidence > 0.75
    assert analysis.feedback_outcome == "correct"
    assert analysis.feedback_confidence == 0.40


def test_completion_is_detected_without_claiming_correctness():
    analysis = analyze_controls([
        control("Quiz completed", "Text", 30),
        control("Your score: 4 out of 5", "Text", 80),
    ])
    assert analysis.completion_visible
    assert analysis.feedback_outcome == "unknown"


def test_live_project_requires_a_window_but_no_calibration_regions():
    config = ProjectCreate.model_validate(project_payload(
        adapter_type="desktop",
        target_config={"window_title": "Owned quiz", "capture_mode": "live", "regions": {}},
    ))
    assert config.target_config.capture_mode == "live"
    assert config.target_config.regions == {}


@pytest.mark.asyncio
async def test_live_adapter_requires_confirmation_before_any_capture():
    adapter, provider, _state = live_adapter(uia_screen(), confirmed=False)
    with pytest.raises(InteractionError):
        await adapter.start()
    assert provider.activations == 0


@pytest.mark.asyncio
async def test_live_adapter_inspects_and_maps_answer_to_actual_control():
    adapter, _provider, _state = live_adapter(uia_screen())
    adapter._click = AsyncMock()
    await adapter.start()
    extraction = await adapter.inspect()
    assert extraction.metadata["capture"] == "live"
    assert extraction.metadata["analysis_source"] == "uia"
    assert extraction.confidence >= 0.75

    result = await adapter.select_answer(ProposedAnswer(kind="options", options=["404"]))
    await adapter.submit()
    assert result.success
    assert result.verified is None
    assert [call.args[0].text for call in adapter._click.call_args_list] == ["404", "Submit"]


@pytest.mark.asyncio
async def test_live_adapter_never_guesses_an_option_position():
    adapter, _provider, _state = live_adapter(uia_screen())
    adapter._click = AsyncMock()
    await adapter.inspect()
    with pytest.raises(InteractionError, match="no position fallback"):
        await adapter.select_answer(ProposedAnswer(kind="options", options=["999"]))
    adapter._click.assert_not_called()


@pytest.mark.asyncio
async def test_live_adapter_rejects_duplicate_answer_labels():
    analysis = analyze_controls([
        control("Which value is correct?", "Text", 20),
        control("Same", "RadioButton", 80, "first"),
        control("Same", "RadioButton", 120, "second"),
        control("Submit", "Button", 180),
    ])
    adapter, _provider, _state = live_adapter(analysis)
    adapter._click = AsyncMock()
    with pytest.raises(ExtractionError, match="Duplicate live answer labels"):
        await adapter.inspect()
    adapter._click.assert_not_called()


@pytest.mark.asyncio
async def test_live_adapter_refuses_stale_question_before_clicking():
    adapter, _provider, state = live_adapter(uia_screen())
    adapter._click = AsyncMock()
    await adapter.inspect()
    state["analysis"] = uia_screen("Which HTTP status code means Unauthorized?")
    with pytest.raises(InteractionError, match="changed before interaction"):
        await adapter.select_answer(ProposedAnswer(kind="options", options=["404"]))
    adapter._click.assert_not_called()


@pytest.mark.asyncio
async def test_live_adapter_observes_auto_advance_and_completion_boundaries():
    adapter, _provider, state = live_adapter(uia_screen())
    await adapter.inspect()
    adapter._submitted_fingerprint = state["analysis"].fingerprint
    state["analysis"] = uia_screen("Which HTTP status code means Unauthorized?")
    observation = await adapter.wait_for_result()
    assert observation.outcome == "unknown"
    assert not observation.feedback_required
    assert "advanced automatically" in observation.error
    navigation = await adapter.next_question()
    assert navigation.success and navigation.has_next

    state["analysis"] = analyze_controls([control("Quiz completed", "Text", 30)])
    adapter._submitted_fingerprint = "submitted-question"
    observation = await adapter.wait_for_result()
    assert observation.outcome == "unknown"
    navigation = await adapter.next_question()
    assert navigation.success and not navigation.has_next


@pytest.mark.asyncio
async def test_live_adapter_feedback_timeout_is_explicit():
    adapter, _provider, state = live_adapter(uia_screen(), feedback_timeout_ms=250)
    await adapter.inspect()
    adapter._submitted_fingerprint = state["analysis"].fingerprint
    observation = await adapter.wait_for_result()
    assert observation.timed_out
    assert observation.feedback_required
    assert observation.outcome == "unknown"
    assert "before timeout" in observation.error
