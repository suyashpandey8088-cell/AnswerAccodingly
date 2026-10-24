from __future__ import annotations

import asyncio
import importlib.util
import re
import shutil
import sys
import time
from collections import defaultdict
from collections.abc import Callable
from typing import Any

from ..schemas.domain import InteractionResult, NavigationResult, ProposedAnswer, VerificationObservation
from .base import ExtractionError, InteractionError, QuizAdapter, RawExtraction
from .desktop import WindowTargetError, WindowsWindowTargetProvider
from .windows_live_analysis import (
    NEXT_PATTERN,
    SUBMIT_PATTERN,
    LiveAnalysis,
    LiveControl,
    analyze_controls,
    normalize_text,
)


OPTION_PREFIX = re.compile(r"^\s*[\(\[]?(?:[A-Fa-f]|[1-6])[\)\].:\-]\s+(.+)$")
OCR_QUESTION_START = re.compile(
    r"^(what|which|why|how|who|when|where|calculate|solve|select|choose|write|explain|define)\b",
    re.IGNORECASE,
)


def classify_ocr_line(value: str) -> tuple[str, str]:
    text = normalize_text(value)
    option_match = OPTION_PREFIX.match(text)
    if option_match:
        text = normalize_text(option_match.group(1))
        math_prompt = re.search(r"\d\s*[-+×x*/=]\s*\d", text)
        looks_like_question = "?" in text or bool(
            OCR_QUESTION_START.match(text) and (len(text) >= 12 or math_prompt)
        )
        return text, "Text" if looks_like_question else "RadioButton"
    if len(text) <= 40 and "?" not in text and (SUBMIT_PATTERN.search(text) or NEXT_PATTERN.search(text)):
        return text, "Button"
    return text, "Text"


def live_runtime_status() -> dict[str, Any]:
    windows = sys.platform == "win32"
    targeting = importlib.util.find_spec("pygetwindow") is not None
    uia = importlib.util.find_spec("pywinauto") is not None
    ocr_modules = all(
        importlib.util.find_spec(name) is not None for name in ("pyautogui", "pytesseract", "cv2")
    )
    ocr = ocr_modules and shutil.which("tesseract") is not None
    if not windows:
        detail = "Live Windows Autopilot requires Windows 10/11 and a visible owned/authorized desktop window."
    elif not targeting:
        detail = "Install the pinned PyGetWindow dependency for safe visible-window selection."
    elif not uia and not ocr:
        detail = "Install pywinauto for UI Automation and the OCR dependencies for fallback."
    else:
        detail = "Live analysis uses Windows UI Automation first and OCR fallback inside the selected window."
    return {
        "available": windows and targeting and (uia or ocr),
        "platform": sys.platform,
        "window_targeting": windows and targeting,
        "uia_available": windows and uia,
        "ocr_available": windows and ocr,
        "detail": detail,
    }


def list_live_windows() -> list[dict[str, Any]]:
    if sys.platform != "win32":
        return []
    try:
        import pygetwindow

        windows = pygetwindow.getAllWindows()
    except (ImportError, OSError):
        return []
    results: list[dict[str, Any]] = []
    for window in windows:
        title = normalize_text(str(getattr(window, "title", "")))
        if not title or getattr(window, "isMinimized", False):
            continue
        try:
            width, height = int(window.width), int(window.height)
            if width < 100 or height < 100:
                continue
            results.append({
                "title": title,
                "application_name": title,
                "bounds": {
                    "x": int(window.left), "y": int(window.top), "width": width, "height": height,
                },
            })
        except (AttributeError, TypeError, ValueError, OSError):
            continue
    return sorted(results, key=lambda item: item["title"].casefold())


class WindowsLiveAdapter(QuizAdapter):
    """Zero-calibration, live UIA/OCR adapter for an explicitly authorized Windows window."""

    def __init__(
        self,
        *,
        target_config: dict[str, Any],
        operator_confirmed: bool,
        operation_timeout_ms: int = 10_000,
        feedback_timeout_ms: int = 5_000,
        window_provider: WindowsWindowTargetProvider | None = None,
        screen_reader: Callable[[], LiveAnalysis] | None = None,
    ) -> None:
        self.target_config = target_config
        self.operator_confirmed = operator_confirmed
        self.operation_timeout_ms = operation_timeout_ms
        self.feedback_timeout_ms = feedback_timeout_ms
        self.window_provider = window_provider or WindowsWindowTargetProvider()
        self.screen_reader = screen_reader
        self._analysis: LiveAnalysis | None = None
        self._submitted_fingerprint: str | None = None
        self._auto_advanced = False
        self._completion_visible = False
        self._bounds: dict[str, int] | None = None

    @property
    def application_name(self) -> str | None:
        return self.target_config.get("application_name") or self.target_config.get("window_title")

    @property
    def window_title(self) -> str | None:
        return self.target_config.get("window_title") or self.target_config.get("application_name")

    async def start(self) -> float:
        if not self.operator_confirmed:
            raise InteractionError("Live desktop control requires operator confirmation")
        if not self.application_name:
            raise InteractionError("Select an authorized visible Windows window before starting")
        if self.screen_reader is None:
            status = live_runtime_status()
            if not status["available"]:
                raise InteractionError(status["detail"])
            await self.window_provider.validate_target(self.application_name, self.window_title)
        started = time.perf_counter()
        await self._activate()
        self._analysis = await self._refresh()
        return (time.perf_counter() - started) * 1000

    async def inspect(self) -> RawExtraction:
        started = time.perf_counter()
        analysis = await self._refresh()
        if analysis.completion_visible and not analysis.question_text:
            raise ExtractionError("The selected window already shows a completion screen")
        if not analysis.question_text:
            raise ExtractionError(
                "Live analysis could not identify the question. Use a supported visible quiz interface; "
                "no coordinates can be supplied."
            )
        if len(analysis.options) == 1 or (not analysis.options and not analysis.text_input):
            raise ExtractionError(
                "Live analysis could not identify answer controls. Native UIA controls or OCR options "
                "labelled A-F/1-6 are supported."
            )
        labels = [normalize_text(control.text).casefold() for control in analysis.options]
        if len(labels) != len(set(labels)):
            raise ExtractionError("Duplicate live answer labels are ambiguous; no option was clicked")
        if analysis.confidence < 0.65:
            raise ExtractionError("Live analysis confidence is too low; the run stopped before interacting")
        self._analysis = analysis
        return RawExtraction(
            question_id=None,
            text=analysis.question_text,
            question_type=analysis.question_type,
            options=[
                {"id": control.key, "label": control.text, "value": control.text}
                for control in analysis.options
            ],
            code_language=self.target_config.get("code_language"),
            timer=analysis.timer,
            confidence=analysis.confidence,
            uncertain=analysis.confidence < 0.75,
            diagnostic_refs=["operator-review-required"] if analysis.confidence < 0.75 else [],
            metadata={
                "capture": "live",
                "analysis_source": analysis.source,
                "screen_fingerprint": analysis.fingerprint,
                "extraction_duration_ms": (time.perf_counter() - started) * 1000,
                **analysis.metadata,
            },
        )

    async def select_answer(self, answer: ProposedAnswer) -> InteractionResult:
        started = time.perf_counter()
        analysis = await self._current_question()
        verified: bool | None = None
        if answer.kind == "options":
            if not analysis.options or not answer.options:
                raise InteractionError("The proposed answer does not contain a live option selection")
            selected_values = list(answer.options)
            for value in selected_values:
                current = await self._current_question()
                control = current.option(value)
                if control is None:
                    raise InteractionError(
                        "The proposed answer is not a live answer control; no position fallback was used"
                    )
                await self._click(control)
            await asyncio.sleep(0.1)
            after = await self._refresh()
            if after.fingerprint == self._analysis.fingerprint:
                states = [after.option(value).selected if after.option(value) else None for value in selected_values]
                if states and all(state is True for state in states):
                    verified = True
                elif any(state is False for state in states):
                    raise InteractionError("UI Automation reported that the requested answer was not selected")
                self._analysis = after
        elif answer.kind in {"text", "code"}:
            value = answer.text if answer.kind == "text" else answer.code
            if not value:
                raise InteractionError("No text or code was supplied for live desktop input")
            if not analysis.text_input:
                raise InteractionError("No live text or code input control was detected")
            await self._write_text(analysis.text_input, value)
        else:
            raise InteractionError("Unsupported live desktop answer")
        return InteractionResult(
            success=True,
            verified=verified,
            actual={
                "state_verification": "uia-selection" if verified is not None else "not-observed",
                "analysis_source": analysis.source,
            },
            duration_ms=(time.perf_counter() - started) * 1000,
        )

    async def submit(self) -> InteractionResult:
        analysis = await self._current_question()
        if not analysis.submit_control:
            raise InteractionError(
                "No enabled Submit/Check control was detected; the run will not guess a click location"
            )
        started = time.perf_counter()
        await self._click(analysis.submit_control)
        self._submitted_fingerprint = analysis.fingerprint
        self._auto_advanced = False
        self._completion_visible = False
        return InteractionResult(
            success=True,
            verified=None,
            actual={"state_verification": "feedback-or-transition-required"},
            duration_ms=(time.perf_counter() - started) * 1000,
        )

    async def wait_for_result(self) -> VerificationObservation:
        started = time.perf_counter()
        deadline = time.monotonic() + self.feedback_timeout_ms / 1000
        while time.monotonic() < deadline:
            analysis = await self._refresh()
            if analysis.completion_visible:
                self._completion_visible = True
                self._analysis = analysis
                return VerificationObservation(
                    feedback_visible=False,
                    feedback_required=False,
                    outcome="unknown",
                    duration_ms=(time.perf_counter() - started) * 1000,
                    error="Completion screen detected; no answer-level correctness was inferred",
                )
            if analysis.feedback_outcome != "unknown" and analysis.feedback_confidence >= 0.65:
                self._analysis = analysis
                return VerificationObservation(
                    feedback_visible=True,
                    outcome=analysis.feedback_outcome,
                    text=analysis.feedback_text,
                    duration_ms=(time.perf_counter() - started) * 1000,
                )
            if (
                self._submitted_fingerprint
                and analysis.fingerprint != self._submitted_fingerprint
                and analysis.question_text
            ):
                self._auto_advanced = True
                self._analysis = analysis
                return VerificationObservation(
                    feedback_visible=False,
                    feedback_required=False,
                    outcome="unknown",
                    duration_ms=(time.perf_counter() - started) * 1000,
                    error="The application advanced automatically; answer-level correctness is unknown",
                )
            if analysis.next_control and time.monotonic() - (deadline - self.feedback_timeout_ms / 1000) >= min(
                1.25, self.feedback_timeout_ms / 1000
            ):
                self._analysis = analysis
                return VerificationObservation(
                    feedback_visible=False,
                    feedback_required=False,
                    outcome="unknown",
                    duration_ms=(time.perf_counter() - started) * 1000,
                    error="No answer feedback was detected; an enabled Next control is available",
                )
            await asyncio.sleep(0.15)
        return VerificationObservation(
            feedback_visible=False,
            outcome="unknown",
            timed_out=True,
            duration_ms=(time.perf_counter() - started) * 1000,
            error="No feedback, completion, or question transition was detected before timeout",
        )

    async def next_question(self) -> NavigationResult:
        started = time.perf_counter()
        if self._completion_visible:
            return NavigationResult(success=True, has_next=False, duration_ms=0)
        if self._auto_advanced:
            self._auto_advanced = False
            self._submitted_fingerprint = None
            return NavigationResult(success=True, has_next=True, duration_ms=(time.perf_counter() - started) * 1000)

        analysis = await self._refresh()
        if analysis.completion_visible:
            self._completion_visible = True
            return NavigationResult(success=True, has_next=False, duration_ms=(time.perf_counter() - started) * 1000)
        if (
            self._submitted_fingerprint
            and analysis.fingerprint != self._submitted_fingerprint
            and analysis.question_text
        ):
            self._submitted_fingerprint = None
            return NavigationResult(success=True, has_next=True, duration_ms=(time.perf_counter() - started) * 1000)
        if not analysis.next_control:
            return NavigationResult(
                success=True,
                has_next=False,
                duration_ms=(time.perf_counter() - started) * 1000,
                error="No enabled Next control was detected; ended without claiming answer correctness",
            )

        previous = analysis.fingerprint
        await self._click(analysis.next_control)
        deadline = time.monotonic() + self.operation_timeout_ms / 1000
        while time.monotonic() < deadline:
            await asyncio.sleep(0.15)
            current = await self._refresh()
            if current.completion_visible:
                self._completion_visible = True
                self._submitted_fingerprint = None
                return NavigationResult(
                    success=True, has_next=False, duration_ms=(time.perf_counter() - started) * 1000
                )
            if current.question_text and current.fingerprint != previous:
                self._analysis = current
                self._submitted_fingerprint = None
                return NavigationResult(success=True, has_next=True, duration_ms=(time.perf_counter() - started) * 1000)
        return NavigationResult(
            success=False,
            has_next=False,
            duration_ms=(time.perf_counter() - started) * 1000,
            error="Next was clicked but the question did not change before timeout",
        )

    async def close(self) -> None:
        self._analysis = None
        self._submitted_fingerprint = None
        self._bounds = None

    async def _activate(self) -> None:
        await self.window_provider.activate_target(self.application_name, self.window_title, {})

    async def _refresh(self) -> LiveAnalysis:
        if self.screen_reader is not None:
            return await asyncio.to_thread(self.screen_reader)
        try:
            return await asyncio.to_thread(self._read_live)
        except WindowTargetError as exc:
            raise ExtractionError(str(exc)) from exc
        except (ImportError, OSError) as exc:
            raise ExtractionError(f"Live Windows capture failed safely: {exc}") from exc

    async def _current_question(self) -> LiveAnalysis:
        if not self._analysis:
            raise InteractionError("No live question has been analyzed")
        current = await self._refresh()
        if current.fingerprint != self._analysis.fingerprint:
            raise InteractionError("The live question changed before interaction; no stale coordinates were used")
        self._analysis = current
        return current

    async def _click(self, control: LiveControl) -> None:
        if not control.enabled:
            raise InteractionError("The detected control is disabled")
        await self._activate()
        current = await self._refresh()
        if self._analysis and current.fingerprint != self._analysis.fingerprint:
            raise InteractionError("The live question changed while focus was being established; no click was sent")
        fresh = self._matching_control(current, control)
        if not fresh.enabled:
            raise InteractionError("The detected control became disabled before the click")
        try:
            window = await asyncio.to_thread(
                self.window_provider.get_window, self.application_name, self.window_title
            )
            if hasattr(window, "isActive") and not window.isActive:
                raise InteractionError("The authorized window lost foreground focus; no input was sent")
            bounds = {
                "x": int(window.left), "y": int(window.top),
                "width": int(window.width), "height": int(window.height),
            }
            self._bounds = bounds
            x, y = fresh.click_point
            if not (
                bounds["x"] <= x < bounds["x"] + bounds["width"]
                and bounds["y"] <= y < bounds["y"] + bounds["height"]
            ):
                raise InteractionError("The live control moved outside the authorized window; no click was sent")
            import pyautogui

            await asyncio.to_thread(pyautogui.click, x, y)
        except InteractionError:
            raise
        except Exception as exc:
            raise InteractionError(f"Unable to click the live Windows control: {type(exc).__name__}") from exc

    @staticmethod
    def _matching_control(analysis: LiveAnalysis, expected: LiveControl) -> LiveControl:
        candidates = [
            *analysis.options, analysis.text_input, analysis.submit_control, analysis.next_control,
        ]
        matches = [
            control for control in candidates
            if control is not None
            and control.control_type == expected.control_type
            and normalize_text(control.text).casefold() == normalize_text(expected.text).casefold()
        ]
        if len(matches) != 1:
            raise InteractionError("The intended live control could not be revalidated uniquely; no click was sent")
        return matches[0]

    async def _write_text(self, control: LiveControl, value: str) -> None:
        await self._click(control)
        try:
            import pyautogui
            import pyperclip

            def replace_text() -> None:
                window = self.window_provider.get_window(self.application_name, self.window_title)
                if hasattr(window, "isActive") and not window.isActive:
                    raise WindowTargetError("The authorized window lost foreground focus before text entry")
                pyautogui.hotkey("ctrl", "a")
                pyperclip.copy(value)
                pyautogui.hotkey("ctrl", "v")

            await asyncio.to_thread(replace_text)
        except Exception as exc:
            raise InteractionError(f"Unable to enter text in the live Windows control: {type(exc).__name__}") from exc

    def _read_live(self) -> LiveAnalysis:
        window = self.window_provider.get_window(self.application_name, self.window_title)
        self._bounds = {
            "x": int(window.left), "y": int(window.top), "width": int(window.width), "height": int(window.height),
        }
        if self._bounds["width"] <= 0 or self._bounds["height"] <= 0:
            raise WindowTargetError("The authorized Windows window has no visible bounds")

        uia_analysis: LiveAnalysis | None = None
        uia_error: str | None = None
        try:
            uia_analysis = analyze_controls(self._uia_controls(window), source="uia")
            if self._usable(uia_analysis):
                return uia_analysis
        except Exception as exc:  # UIA providers raise library-specific COM errors; OCR remains in the same window.
            uia_error = type(exc).__name__

        try:
            ocr_analysis = analyze_controls(self._ocr_controls(), source="ocr")
            if self._usable(ocr_analysis) or ocr_analysis.question_text:
                if uia_error:
                    ocr_analysis.metadata["uia_fallback_reason"] = uia_error
                return ocr_analysis
        except Exception as exc:
            if uia_analysis is not None and uia_analysis.question_text:
                uia_analysis.metadata["ocr_fallback_reason"] = type(exc).__name__
                return uia_analysis
            raise ExtractionError(f"Live UIA and OCR analysis failed safely: {type(exc).__name__}") from exc

        if uia_analysis is not None:
            return uia_analysis
        raise ExtractionError("Neither UIA nor OCR returned live window content")

    @staticmethod
    def _usable(analysis: LiveAnalysis) -> bool:
        return analysis.completion_visible or bool(
            analysis.question_text and (len(analysis.options) >= 2 or analysis.text_input)
        )

    def _uia_controls(self, window: Any) -> list[LiveControl]:
        import pythoncom

        pythoncom.CoInitialize()
        try:
            return self._uia_controls_on_com_thread(window)
        finally:
            pythoncom.CoUninitialize()

    def _uia_controls_on_com_thread(self, window: Any) -> list[LiveControl]:
        from pywinauto import Desktop

        handle = getattr(window, "_hWnd", None)
        desktop = Desktop(backend="uia")
        uia_window = desktop.window(handle=handle) if handle else desktop.window(title=str(window.title))
        controls: list[LiveControl] = []
        for index, item in enumerate(uia_window.descendants()):
            try:
                if hasattr(item, "is_visible") and not item.is_visible():
                    continue
                text = normalize_text(str(item.window_text() or ""))
                control_type = str(item.control_type())
                if not text and control_type not in {"Edit", "Document", "ComboBox", "TextBox"}:
                    continue
                rectangle = item.rectangle()
                x, y = int(rectangle.left), int(rectangle.top)
                width, height = int(rectangle.right) - x, int(rectangle.bottom) - y
                if width <= 0 or height <= 0 or not self._point_in_bounds(x + width // 2, y + height // 2):
                    continue
                try:
                    enabled = bool(item.is_enabled())
                except Exception:
                    enabled = True
                selected: bool | None = None
                if control_type in {"RadioButton", "CheckBox"}:
                    reader_names = ("is_selected", "get_toggle_state") if control_type == "RadioButton" else (
                        "get_toggle_state", "is_selected",
                    )
                    for reader_name in reader_names:
                        try:
                            selected = bool(getattr(item, reader_name)())
                            break
                        except Exception:
                            selected = None
                automation_id = ""
                try:
                    automation_id = str(item.automation_id() or "")
                except Exception:
                    pass
                key = automation_id or f"{control_type}-{index}-{x}-{y}"
                controls.append(LiveControl(
                    key=key,
                    text=text,
                    control_type=control_type,
                    x=x,
                    y=y,
                    width=width,
                    height=height,
                    enabled=enabled,
                    selected=selected,
                ))
            except Exception:
                # Individual unsupported UIA elements are skipped; recognized controls must still agree as a screen.
                continue
        return controls

    def _ocr_controls(self) -> list[LiveControl]:
        import cv2
        import numpy as np
        import pyautogui
        import pytesseract
        from pytesseract import Output

        assert self._bounds is not None
        image = pyautogui.screenshot(region=(
            self._bounds["x"], self._bounds["y"], self._bounds["width"], self._bounds["height"],
        ))
        pixels = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2GRAY)
        scale = 2
        enlarged = cv2.resize(pixels, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        threshold = cv2.threshold(enlarged, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
        data = pytesseract.image_to_data(threshold, config="--oem 3 --psm 11", output_type=Output.DICT)
        grouped: dict[tuple[int, int, int], list[int]] = defaultdict(list)
        for index, raw_text in enumerate(data["text"]):
            if normalize_text(str(raw_text)):
                group = (
                    int(data["block_num"][index]), int(data["par_num"][index]), int(data["line_num"][index]),
                )
                grouped[group].append(index)

        controls: list[LiveControl] = []
        for line_number, (_group, indexes) in enumerate(sorted(grouped.items())):
            text = normalize_text(" ".join(str(data["text"][index]) for index in indexes))
            confidences: list[float] = []
            for index in indexes:
                try:
                    confidence = float(data["conf"][index])
                    if confidence >= 0:
                        confidences.append(confidence / 100)
                except (TypeError, ValueError):
                    continue
            confidence = sum(confidences) / len(confidences) if confidences else 0.0
            if confidence < 0.35:
                continue
            left = min(int(data["left"][index]) for index in indexes) // scale
            top = min(int(data["top"][index]) for index in indexes) // scale
            right = max(int(data["left"][index]) + int(data["width"][index]) for index in indexes) // scale
            bottom = max(int(data["top"][index]) + int(data["height"][index]) for index in indexes) // scale
            text, control_type = classify_ocr_line(text)
            controls.append(LiveControl(
                key=f"ocr-line-{line_number}",
                text=text,
                control_type=control_type,
                x=self._bounds["x"] + left,
                y=self._bounds["y"] + top,
                width=max(1, right - left),
                height=max(1, bottom - top),
                confidence=confidence,
            ))
        return sorted(controls, key=lambda control: (control.y, control.x))

    def _point_in_bounds(self, x: int, y: int) -> bool:
        if not self._bounds:
            return False
        return (
            self._bounds["x"] <= x < self._bounds["x"] + self._bounds["width"]
            and self._bounds["y"] <= y < self._bounds["y"] + self._bounds["height"]
        )
