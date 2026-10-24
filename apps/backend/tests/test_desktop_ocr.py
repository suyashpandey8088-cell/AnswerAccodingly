from unittest.mock import AsyncMock, patch

import pytest
from PIL import Image

from app.adapters.base import InteractionError
from app.adapters.desktop import DesktopAdapter, WindowsWindowTargetProvider
from app.schemas.domain import TimerStatus
from app.services.normalization import parse_timer


def test_ocr_text_and_confidence_are_preserved():
    image = Image.new("RGB", (100, 30), "white")
    fake_data = {"text": ["Time", "01:30", ""], "conf": ["90", "80", "-1"]}
    with patch("pytesseract.image_to_data", return_value=fake_data):
        text, confidence = DesktopAdapter._ocr_image(image)
    assert text == "Time 01:30"
    assert confidence == 85


def test_ocr_uncertainty_is_not_treated_as_certain_or_zero():
    timer = parse_timer("01:30", method="ocr", confidence=0.5)
    assert timer.status == TimerStatus.uncertain
    assert timer.seconds == 90
    failed = parse_timer("blurry", method="ocr", confidence=0.1)
    assert failed.status == TimerStatus.failed
    assert failed.seconds is None


@pytest.mark.asyncio
async def test_desktop_never_guesses_coordinates():
    adapter = DesktopAdapter(target_config={"regions": {}}, operator_confirmed=True)
    with pytest.raises(Exception, match="not calibrated"):
        await adapter._click_region("submit")


def test_desktop_maps_answer_text_to_the_actual_ocr_option():
    adapter = DesktopAdapter(target_config={"regions": {}}, operator_confirmed=True)
    adapter._last_options = [
        {"id": "option_1", "label": "London", "value": "London"},
        {"id": "option_2", "label": " Paris ", "value": " Paris "},
    ]
    assert adapter._option_region("Paris") == "option_2"
    assert adapter._option_region("option_1") == "option_1"
    with pytest.raises(InteractionError, match="refusing to guess"):
        adapter._option_region("Berlin")


class FakeWindow:
    def __init__(self, title="Authorized Quiz", *, active=False, minimized=False):
        self.title = title
        self.left, self.top, self.width, self.height = 100, 100, 800, 600
        self.isActive = active
        self.isMinimized = minimized
        self.activated = False
        self.restored = False

    def activate(self):
        self.activated = True
        self.isActive = True

    def restore(self):
        self.restored = True
        self.isMinimized = False


REGIONS = {
    "question": {"x": 120, "y": 120, "width": 300, "height": 100},
    "answer": {"x": 120, "y": 250, "width": 300, "height": 100},
    "submit": {"x": 120, "y": 400, "width": 100, "height": 40},
}


@pytest.mark.asyncio
async def test_windows_target_is_unique_focused_and_window_contained():
    window = FakeWindow(minimized=True)
    provider = WindowsWindowTargetProvider(window_source=lambda: [window, FakeWindow("Unrelated")])
    await provider.validate_target(None, "Authorized Quiz")
    await provider.activate_target(None, "Authorized Quiz", REGIONS)
    assert window.restored and window.activated and window.isActive


@pytest.mark.asyncio
async def test_windows_target_rejects_ambiguous_titles_and_outside_regions():
    provider = WindowsWindowTargetProvider(window_source=lambda: [FakeWindow("Quiz One"), FakeWindow("Quiz Two")])
    with pytest.raises(Exception, match="Multiple Windows windows"):
        await provider.validate_target(None, "Quiz")

    window = FakeWindow()
    provider = WindowsWindowTargetProvider(window_source=lambda: [window])
    outside = {**REGIONS, "submit": {"x": 850, "y": 400, "width": 100, "height": 40}}
    with pytest.raises(InteractionError, match="outside the authorized window"):
        await provider.activate_target(None, "Authorized Quiz", outside)
    assert not window.activated


@pytest.mark.asyncio
async def test_windows_focus_denial_prevents_input():
    class FocusDeniedWindow(FakeWindow):
        def activate(self):
            self.activated = True
            self.isActive = False

    window = FocusDeniedWindow()
    provider = WindowsWindowTargetProvider(window_source=lambda: [window])
    with pytest.raises(InteractionError, match="foreground focus"):
        await provider.activate_target(None, "Authorized Quiz", REGIONS)


@pytest.mark.asyncio
async def test_feedback_waits_for_a_delayed_observable_outcome():
    adapter = DesktopAdapter(
        target_config={"regions": {"feedback": REGIONS["question"]}},
        operator_confirmed=True,
        feedback_timeout_ms=1000,
    )
    adapter._ocr_region = AsyncMock(side_effect=[("", 0, 1), ("Correct", 92, 1)])
    observation = await adapter.wait_for_result()
    assert observation.outcome == "correct"
    assert not observation.timed_out
    assert adapter._ocr_region.await_count == 2


@pytest.mark.asyncio
async def test_low_confidence_feedback_remains_unknown():
    adapter = DesktopAdapter(
        target_config={"regions": {"feedback": REGIONS["question"]}},
        operator_confirmed=True,
    )
    adapter._ocr_region = AsyncMock(return_value=("Correct", 42, 1))
    observation = await adapter.wait_for_result()
    assert observation.outcome == "unknown"
    assert "confidence is too low" in observation.error


@pytest.mark.desktop
@pytest.mark.asyncio
async def test_graphical_desktop_smoke(desktop_enabled):
    pytest.skip("Configure an authorized Windows fixture window and regions before running the graphical smoke test")
