from __future__ import annotations

import asyncio
import importlib.util
import os
import shutil
import sys
import time
from abc import ABC, abstractmethod
from typing import Any

from ..schemas.domain import InteractionResult, NavigationResult, ProposedAnswer, TimerData, TimerStatus, VerificationObservation
from ..services.normalization import parse_timer
from .base import ExtractionError, InteractionError, QuizAdapter, RawExtraction, SubmissionError


def desktop_availability() -> dict[str, Any]:
    modules = {name: importlib.util.find_spec(name) is not None for name in ("pyautogui", "PIL", "pytesseract", "cv2")}
    graphical_session = sys.platform != "linux" or bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))
    tesseract = shutil.which("tesseract") is not None
    available = all(modules.values()) and tesseract and graphical_session
    reasons = []
    if not tesseract:
        reasons.append("Tesseract executable is unavailable")
    if not all(modules.values()):
        reasons.append("One or more Python OCR/input modules are unavailable")
    if not graphical_session:
        reasons.append("No graphical desktop session is visible")
    return {
        "available": available,
        "modules": modules,
        "tesseract": tesseract,
        "graphical_session": graphical_session,
        "detail": "Ready for explicitly calibrated visible input" if available else "; ".join(reasons),
        "supported_window_selection": "Operator-calibrated screen regions; native window enumeration is platform-dependent and not enabled",
    }


class WindowTargetProvider(ABC):
    @abstractmethod
    async def validate_target(self, application_name: str | None, window_title: str | None) -> None:
        raise NotImplementedError


class OperatorSelectedWindowProvider(WindowTargetProvider):
    """Portable fallback: the operator identifies and calibrates the visible target."""

    async def validate_target(self, application_name: str | None, window_title: str | None) -> None:
        if not (application_name or window_title):
            raise ExtractionError("An explicit desktop application or window title is required")


class DesktopAdapter(QuizAdapter):
    def __init__(
        self,
        *,
        target_config: dict[str, Any],
        operator_confirmed: bool,
        operation_timeout_ms: int = 10_000,
        feedback_timeout_ms: int = 5_000,
        window_provider: WindowTargetProvider | None = None,
    ) -> None:
        self.target_config = target_config
        self.regions = target_config.get("regions") or {}
        self.operator_confirmed = operator_confirmed
        self.operation_timeout_ms = operation_timeout_ms
        self.feedback_timeout_ms = feedback_timeout_ms
        self.window_provider = window_provider or OperatorSelectedWindowProvider()
        self._last_capture: Any = None
        self._last_observation = VerificationObservation(feedback_visible=False, duration_ms=0)

    async def start(self) -> float:
        started = time.perf_counter()
        availability = await asyncio.to_thread(desktop_availability)
        if not availability["available"]:
            raise ExtractionError(availability["detail"])
        if not self.operator_confirmed:
            raise ExtractionError("Desktop automation requires explicit operator confirmation")
        await self.window_provider.validate_target(
            self.target_config.get("application_name"), self.target_config.get("window_title")
        )
        for required in ("question", "answer", "submit"):
            self._region(required)
        self._last_capture = await self._capture("question")
        return (time.perf_counter() - started) * 1000

    async def inspect(self) -> RawExtraction:
        started = time.perf_counter()
        try:
            question_text, question_confidence, ocr_ms = await self._ocr_region("question")
            if not question_text:
                raise ExtractionError("OCR did not extract question text; operator review is required")
            options = []
            for name in sorted(self.regions):
                if name.startswith("option_"):
                    text, confidence, duration = await self._ocr_region(name)
                    ocr_ms += duration
                    if text:
                        options.append({"id": name, "label": text, "value": text, "confidence": confidence})
            timer = TimerData(status=TimerStatus.absent, method="ocr")
            timer_ms = 0.0
            if "timer" in self.regions:
                timer_started = time.perf_counter()
                raw_timer, timer_confidence, duration = await self._ocr_region("timer")
                ocr_ms += duration
                timer = parse_timer(raw_timer, method="ocr", confidence=timer_confidence / 100)
                timer_ms = (time.perf_counter() - timer_started) * 1000
            confidence = min([question_confidence / 100, *[item["confidence"] / 100 for item in options]] or [0])
            for item in options:
                item.pop("confidence", None)
            return RawExtraction(
                question_id=None,
                text=question_text,
                question_type=self.target_config.get("question_type"),
                options=options,
                code_language=self.target_config.get("code_language"),
                timer=timer,
                confidence=confidence,
                uncertain=confidence < 0.75,
                diagnostic_refs=["operator-review-required"] if confidence < 0.75 else [],
                metadata={"ocr_ms": ocr_ms, "timer_parsing_ms": timer_ms},
            )
        except ExtractionError:
            raise
        except Exception as exc:
            raise ExtractionError(f"Desktop OCR extraction failed: {type(exc).__name__}") from exc
        finally:
            # Duration is measured by the normalizer/runner from the same monotonic clock.
            _ = (time.perf_counter() - started) * 1000

    async def select_answer(self, answer: ProposedAnswer) -> InteractionResult:
        started = time.perf_counter()
        before = await self._capture("answer")
        if answer.kind == "options":
            for index, value in enumerate(answer.options, start=1):
                region_name = f"option_{value}" if f"option_{value}" in self.regions else f"option_{index}"
                self._region(region_name)
                await self._click_region(region_name)
        elif answer.kind in {"text", "code"}:
            value = answer.text if answer.kind == "text" else answer.code
            if not value:
                raise InteractionError("No text or code was supplied for desktop input")
            await self._click_region("answer")
            await asyncio.to_thread(self._write_visible, value)
        else:
            raise InteractionError("Unsupported desktop answer")
        changed, after = await self._post_action_change("answer", before)
        self._last_capture = after
        return InteractionResult(
            success=True,
            verified=True if changed else None,
            actual={"observable_screen_change": changed, "state_verification": "pixel-change-only"},
            duration_ms=(time.perf_counter() - started) * 1000,
        )

    async def submit(self) -> InteractionResult:
        started = time.perf_counter()
        before = await self._capture("question")
        await self._click_region("submit")
        changed, after = await self._post_action_change("question", before)
        self._last_capture = after
        return InteractionResult(
            success=True,
            verified=True if changed else None,
            actual={"observable_screen_change": changed},
            duration_ms=(time.perf_counter() - started) * 1000,
        )

    async def wait_for_result(self) -> VerificationObservation:
        started = time.perf_counter()
        if "feedback" not in self.regions:
            self._last_observation = VerificationObservation(
                feedback_visible=False,
                duration_ms=(time.perf_counter() - started) * 1000,
                error="No feedback region is calibrated; correctness and feedback remain unknown",
            )
            return self._last_observation
        text, confidence, _ = await self._ocr_region("feedback")
        lowered = text.casefold()
        outcome = "correct" if "correct" in lowered and "incorrect" not in lowered else "incorrect" if "incorrect" in lowered else "unknown"
        self._last_observation = VerificationObservation(
            feedback_visible=bool(text),
            outcome=outcome,
            text=text,
            duration_ms=(time.perf_counter() - started) * 1000,
            error="OCR feedback is uncertain" if confidence < 75 else None,
        )
        return self._last_observation

    async def next_question(self) -> NavigationResult:
        started = time.perf_counter()
        if "next" not in self.regions:
            return NavigationResult(success=True, has_next=False, duration_ms=(time.perf_counter() - started) * 1000)
        before = await self._capture("question")
        await self._click_region("next")
        changed, _ = await self._post_action_change("question", before)
        return NavigationResult(
            success=changed,
            has_next=changed,
            duration_ms=(time.perf_counter() - started) * 1000,
            error=None if changed else "No observable question transition; navigation is unverified",
        )

    async def close(self) -> None:
        self._last_capture = None

    async def _ocr_region(self, name: str) -> tuple[str, float, float]:
        started = time.perf_counter()
        image = await self._capture(name)
        return (*await asyncio.to_thread(self._ocr_image, image), (time.perf_counter() - started) * 1000)

    async def _capture(self, name: str) -> Any:
        region = self._region(name)
        return await asyncio.to_thread(self._screenshot, region)

    @staticmethod
    def _screenshot(region: dict[str, int]) -> Any:
        import pyautogui

        return pyautogui.screenshot(region=(region["x"], region["y"], region["width"], region["height"]))

    @staticmethod
    def _ocr_image(image: Any) -> tuple[str, float]:
        import cv2
        import numpy as np
        import pytesseract
        from PIL import Image
        from pytesseract import Output

        gray = np.array(image.convert("L"))
        scaled = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        processed = cv2.threshold(scaled, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
        data = pytesseract.image_to_data(Image.fromarray(processed), output_type=Output.DICT, config="--psm 6")
        words, confidences = [], []
        for text, confidence in zip(data.get("text", []), data.get("conf", [])):
            if text.strip():
                words.append(text.strip())
                try:
                    value = float(confidence)
                    if value >= 0:
                        confidences.append(value)
                except (TypeError, ValueError):
                    pass
        confidence = sum(confidences) / len(confidences) if confidences else 0.0
        return " ".join(words).strip(), confidence

    async def _post_action_change(self, region: str, before: Any) -> tuple[bool, Any]:
        await asyncio.sleep(0.1)  # Allow visible paint; correctness still requires configured OCR assertions.
        after = await self._capture(region)
        return before.tobytes() != after.tobytes(), after

    async def _click_region(self, name: str) -> None:
        region = self._region(name)
        # Coordinates are derived only from an operator-calibrated region, never guessed.
        x = region["x"] + region["width"] // 2
        y = region["y"] + region["height"] // 2
        await asyncio.to_thread(self._click_visible, x, y)

    @staticmethod
    def _click_visible(x: int, y: int) -> None:
        import pyautogui

        pyautogui.click(x=x, y=y)

    @staticmethod
    def _write_visible(value: str) -> None:
        import pyautogui

        pyautogui.write(value, interval=0.01)

    def _region(self, name: str) -> dict[str, int]:
        region = self.regions.get(name)
        if not region:
            raise InteractionError(f"Desktop region {name!r} is not calibrated")
        return region
