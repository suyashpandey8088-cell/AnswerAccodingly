from unittest.mock import patch

import pytest
from PIL import Image

from app.adapters.desktop import DesktopAdapter
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


@pytest.mark.desktop
@pytest.mark.asyncio
async def test_graphical_desktop_smoke(desktop_enabled):
    # Intentionally explicit: requires an operator-calibrated target and is not a CI test.
    pytest.skip("Configure a fixture window and regions before running the graphical smoke test")
