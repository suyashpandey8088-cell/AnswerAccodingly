from __future__ import annotations

import asyncio
import importlib.util
import os
import re
import shutil
import sys
import time
from abc import ABC, abstractmethod
from collections.abc import Callable
from typing import Any

from ..schemas.domain import InteractionResult, NavigationResult, ProposedAnswer, TimerData, TimerStatus, VerificationObservation
from ..services.normalization import parse_timer
from .base import ExtractionError, InteractionError, QuizAdapter, RawExtraction


def desktop_availability() -> dict[str, Any]:
    modules = {name: importlib.util.find_spec(name) is not None for name in ("pyautogui", "PIL", "pytesseract", "cv2")}
    graphical_session = sys.platform != "linux" or bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))
    tesseract = shutil.which("tesseract") is not None
    windows_targeting = sys.platform == "win32" and importlib.util.find_spec("pygetwindow") is not None
    available = all(modules.values()) and tesseract and graphical_session and (sys.platform != "win32" or windows_targeting)
    reasons = []
    if not tesseract:
        reasons.append("Tesseract executable is unavailable")
    if not all(modules.values()):
        reasons.append("One or more Python OCR/input modules are unavailable")
    if not graphical_session:
        reasons.append("No graphical desktop session is visible")
    if sys.platform == "win32" and not windows_targeting:
        reasons.append("PyGetWindow is unavailable for safe Windows window targeting")
    return {
        "available": available,
        "modules": modules,
        "tesseract": tesseract,
        "graphical_session": graphical_session,
        "platform": sys.platform,
        "windows_window_targeting": windows_targeting,
        "detail": "Ready for explicitly targeted, calibrated visible input" if available else "; ".join(reasons),
        "supported_window_selection": (
            "Unique Windows title matching, foreground-focus verification and window-bounds checks"
            if sys.platform == "win32"
            else "Operator-calibrated screen regions; native window focus is implemented only for Windows"
        ),
    }


class WindowTargetError(RuntimeError):
    pass


class WindowTargetProvider(ABC):
    @abstractmethod
    async def validate_target(self, application_name: str | None, window_title: str | None) -> None:
        raise NotImplementedError

    async def activate_target(
        self,
        application_name: str | None,
        window_title: str | None,
        regions: dict[str, dict[str, int]],
    ) -> None:
        """Portable providers cannot focus a window; calibrated input remains explicit."""
        return None


class OperatorSelectedWindowProvider(WindowTargetProvider):
    """Portable fallback: the operator identifies and calibrates the visible target."""

    async def validate_target(self, application_name: str | None, window_title: str | None) -> None:
        if not (application_name or window_title):
            raise ExtractionError("An explicit desktop application or window title is required")


class WindowsWindowTargetProvider(WindowTargetProvider):
    """Targets one visible Windows window without focus-stealing or coordinate guesses."""

    def __init__(self, window_source: Callable[[], list[Any]] | None = None) -> None:
        self.window_source = window_source

    def _windows(self) -> list[Any]:
        if self.window_source:
            return self.window_source()
        import pygetwindow

        return list(pygetwindow.getAllWindows())

    def _find_window(self, application_name: str | None, window_title: str | None) -> Any:
        target = (window_title or application_name or "").strip()
        if not target:
            raise WindowTargetError("An explicit Windows application or window title is required")
        needle = " ".join(target.split()).casefold()

        def normalized_title(window: Any) -> str:
            return " ".join(str(getattr(window, "title", "")).split()).casefold()

        candidates = [window for window in self._windows() if needle in normalized_title(window)]
        exact = [window for window in candidates if normalized_title(window) == needle]
        matches = exact or candidates
        if not matches:
            raise WindowTargetError(f"No visible Windows window matches {target!r}")
        if len(matches) != 1:
            raise WindowTargetError(f"Multiple Windows windows match {target!r}; use a unique full window title")
        return matches[0]

    def get_window(self, application_name: str | None, window_title: str | None) -> Any:
        return self._find_window(application_name, window_title)

    @staticmethod
    def _validate_regions(window: Any, regions: dict[str, dict[str, int]]) -> None:
        left, top = int(window.left), int(window.top)
        right, bottom = left + int(window.width), top + int(window.height)
        if right <= left or bottom <= top:
            raise WindowTargetError("The authorized Windows window has no visible bounds")
        for name, region in regions.items():
            region_right = region["x"] + region["width"]
            region_bottom = region["y"] + region["height"]
            if region["x"] < left or region["y"] < top or region_right > right or region_bottom > bottom:
                raise WindowTargetError(f"Region {name!r} is outside the authorized window; recalibrate before running")

    async def validate_target(self, application_name: str | None, window_title: str | None) -> None:
        try:
            await asyncio.to_thread(self._find_window, application_name, window_title)
        except WindowTargetError as exc:
            raise ExtractionError(str(exc)) from exc

    async def activate_target(
        self,
        application_name: str | None,
        window_title: str | None,
        regions: dict[str, dict[str, int]],
    ) -> None:
        def activate() -> None:
            window = self._find_window(application_name, window_title)
            if getattr(window, "isMinimized", False):
                window.restore()
                time.sleep(0.1)
            self._validate_regions(window, regions)
            window.activate()
            time.sleep(0.15)
            if hasattr(window, "isActive") and not window.isActive:
                raise WindowTargetError("Windows did not grant foreground focus; no input was sent")

        try:
            await asyncio.to_thread(activate)
        except WindowTargetError as exc:
            raise InteractionError(str(exc)) from exc


def default_window_provider() -> WindowTargetProvider:
    return WindowsWindowTargetProvider() if sys.platform == "win32" else OperatorSelectedWindowProvider()


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
        self.window_provider = window_provider or default_window_provider()
        self._last_capture: Any = None
        self._last_observation = VerificationObservation(feedback_visible=False, duration_ms=0)
        self._last_options: list[dict[str, Any]] = []

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
        await self._activate_target()
        self._last_capture = await self._capture("question")
        return (time.perf_counter() - started) * 1000

    async def inspect(self) -> RawExtraction:
        started = time.perf_counter()
        try:
            await self._activate_target()
            question_text, question_confidence, ocr_ms = await self._ocr_region("question")
            if not question_text:
                raise ExtractionError("OCR did not extract question text; stopping instead of guessing")
            options = []
            for name in sorted(self.regions, key=self._option_sort_key):
                if name.startswith("option_"):
                    text, confidence, duration = await self._ocr_region(name)
                    ocr_ms += duration
                    if text:
                        options.append({"id": name, "label": text, "value": text, "confidence": confidence})
            self._last_options = [dict(item) for item in options]
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
        except (ExtractionError, InteractionError):
            raise
        except Exception as exc:
            raise ExtractionError(f"Desktop OCR extraction failed: {type(exc).__name__}") from exc
        finally:
            _ = (time.perf_counter() - started) * 1000

    async def select_answer(self, answer: ProposedAnswer) -> InteractionResult:
        started = time.perf_counter()
        before = await self._capture("answer")
        if answer.kind == "options":
            for value in answer.options:
                await self._click_region(self._option_region(value))
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
        deadline = time.monotonic() + self.feedback_timeout_ms / 1000
        last_text, last_confidence = "", 0.0
        while True:
            last_text, last_confidence, _ = await self._ocr_region("feedback")
            lowered = last_text.casefold()
            outcome = (
                "incorrect"
                if any(marker in lowered for marker in ("incorrect", "not correct", "wrong"))
                else "correct"
                if any(marker in lowered for marker in ("correct", "right answer"))
                else "unknown"
            )
            if outcome != "unknown":
                confident = last_confidence >= 75
                self._last_observation = VerificationObservation(
                    feedback_visible=True,
                    outcome=outcome if confident else "unknown",
                    text=last_text,
                    duration_ms=(time.perf_counter() - started) * 1000,
                    error=None if confident else "OCR feedback confidence is too low to trust the outcome",
                )
                return self._last_observation
            if await self._completion_visible():
                self._last_observation = VerificationObservation(
                    feedback_visible=False,
                    outcome="unknown",
                    text=last_text or None,
                    duration_ms=(time.perf_counter() - started) * 1000,
                )
                return self._last_observation
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self._last_observation = VerificationObservation(
                    feedback_visible=bool(last_text),
                    outcome="unknown",
                    text=last_text or None,
                    timed_out=True,
                    duration_ms=(time.perf_counter() - started) * 1000,
                    error="Feedback deadline expired without a readable outcome; stopping the autonomous run",
                )
                return self._last_observation
            await asyncio.sleep(min(0.25, remaining))

    async def next_question(self) -> NavigationResult:
        started = time.perf_counter()
        if await self._completion_visible():
            return NavigationResult(success=True, has_next=False, duration_ms=(time.perf_counter() - started) * 1000)
        if "next" not in self.regions:
            return NavigationResult(success=True, has_next=False, duration_ms=(time.perf_counter() - started) * 1000)
        before = await self._capture("question")
        await self._click_region("next")
        changed, _ = await self._post_action_change("question", before)
        if not changed and await self._completion_visible():
            return NavigationResult(success=True, has_next=False, duration_ms=(time.perf_counter() - started) * 1000)
        return NavigationResult(
            success=changed,
            has_next=changed,
            duration_ms=(time.perf_counter() - started) * 1000,
            error=None if changed else "No observable question transition or completion; autonomous navigation stopped",
        )

    async def close(self) -> None:
        self._last_capture = None
        self._last_options = []

    async def _activate_target(self) -> None:
        await self.window_provider.activate_target(
            self.target_config.get("application_name"), self.target_config.get("window_title"), self.regions
        )

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
        await asyncio.sleep(0.1)
        after = await self._capture(region)
        return before.tobytes() != after.tobytes(), after

    async def _click_region(self, name: str) -> None:
        region = self._region(name)
        await self._activate_target()
        # Coordinates come only from an operator-calibrated, window-contained region.
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

        # Replace the previous answer instead of appending to it on later questions.
        pyautogui.hotkey("ctrl", "a")
        pyautogui.write(value, interval=0.01)

    def _option_region(self, value: str) -> str:
        normalized = self._normalize_option(value)
        for option in self._last_options:
            candidates = (option.get("id"), option.get("label"), option.get("value"))
            if any(candidate is not None and self._normalize_option(str(candidate)) == normalized for candidate in candidates):
                return str(option["id"])
        raise InteractionError("The solved answer does not match an OCR option; refusing to guess a click position")

    async def _completion_visible(self) -> bool:
        if "complete" not in self.regions:
            return False
        text, confidence, _ = await self._ocr_region("complete")
        if confidence < 75:
            return False
        return bool(re.search(r"\b(complete|completed|finished|results?|score)\b", text, flags=re.IGNORECASE))

    def _region(self, name: str) -> dict[str, int]:
        region = self.regions.get(name)
        if not region:
            raise InteractionError(f"Desktop region {name!r} is not calibrated")
        return region

    @staticmethod
    def _normalize_option(value: str) -> str:
        return " ".join(value.split()).casefold()

    @staticmethod
    def _option_sort_key(name: str) -> tuple[int, int, str]:
        if not name.startswith("option_"):
            return (0, 0, name)
        suffix = name.removeprefix("option_")
        return (1, int(suffix) if suffix.isdigit() else 0, suffix)
