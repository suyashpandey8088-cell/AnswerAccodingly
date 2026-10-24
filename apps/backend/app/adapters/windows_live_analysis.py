from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Any, Literal

from ..schemas.domain import TimerData, TimerStatus
from ..services.normalization import parse_timer


SUBMIT_PATTERN = re.compile(r"\b(submit|check(?:\s+answer)?|confirm|finish|done)\b", re.IGNORECASE)
NEXT_PATTERN = re.compile(r"\b(next(?:\s+question)?|continue)\b", re.IGNORECASE)
COMPLETE_PATTERN = re.compile(
    r"\b(quiz|test|assessment)\s+(?:is\s+)?(?:complete|completed|finished)\b|"
    r"\byour\s+(?:final\s+)?score\b|\bquiz\s+results?\b|\bno\s+more\s+questions\b",
    re.IGNORECASE,
)
QUESTION_WORDS = re.compile(
    r"\b(what|which|why|how|who|whom|when|where|calculate|solve|select|choose|write|explain|define|describe|"
    r"true|false|capital|value|output|result)\b",
    re.IGNORECASE,
)
IGNORED_BUTTON_LABELS = {
    "ok", "cancel", "close", "back", "settings", "help", "login", "log in", "sign in", "exit", "minimize", "maximize",
    "hint", "skip", "report", "menu", "save", "pause", "resume", "previous", "review", "flag",
}
ACTION_TYPES = {"Button", "InvokeButton", "Hyperlink", "Link", "SplitButton", "MenuItem"}
INPUT_TYPES = {"Edit", "Document", "ComboBox", "TextBox"}
OPTION_TYPES = {"RadioButton", "CheckBox", "ListItem", "DataItem"}
TEXT_TYPES = {"Text", "Static", "Label", "Pane", "Group", "Custom", "ContentControl"}


@dataclass(frozen=True)
class LiveControl:
    key: str
    text: str
    control_type: str
    x: int
    y: int
    width: int
    height: int
    confidence: float = 1.0
    enabled: bool = True
    selected: bool | None = None

    @property
    def click_point(self) -> tuple[int, int]:
        return (self.x + self.width // 2, self.y + self.height // 2)

    @property
    def bounds(self) -> tuple[int, int, int, int]:
        return (self.x, self.y, self.width, self.height)


@dataclass
class LiveAnalysis:
    source: Literal["uia", "ocr"]
    question_text: str = ""
    question_type: str | None = None
    options: list[LiveControl] = field(default_factory=list)
    text_input: LiveControl | None = None
    submit_control: LiveControl | None = None
    next_control: LiveControl | None = None
    completion_visible: bool = False
    feedback_outcome: Literal["correct", "incorrect", "unknown"] = "unknown"
    feedback_text: str | None = None
    feedback_confidence: float = 0.0
    timer: TimerData = field(default_factory=lambda: TimerData(status=TimerStatus.absent))
    confidence: float = 0.0
    fingerprint: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def option(self, value: str) -> LiveControl | None:
        normalized = normalize_text(value).casefold()
        for option in self.options:
            if normalize_text(option.text).casefold() == normalized or option.key.casefold() == normalized:
                return option
        return None


def normalize_text(value: str) -> str:
    return " ".join(value.split()).strip()


def analyze_controls(controls: list[LiveControl], *, source: Literal["uia", "ocr"] = "uia") -> LiveAnalysis:
    visible = [
        control for control in controls
        if control.width > 0 and control.height > 0
        and (normalize_text(control.text) or control.control_type in INPUT_TYPES)
    ]
    analysis = LiveAnalysis(source=source)
    analysis.timer = _find_timer(visible, source)

    submit = _find_action(visible, SUBMIT_PATTERN)
    next_control = _find_action(visible, NEXT_PATTERN)
    analysis.submit_control = submit
    analysis.next_control = next_control
    inputs = [control for control in visible if control.control_type in INPUT_TYPES and control.enabled]
    analysis.text_input = inputs[0] if len(inputs) == 1 else None

    used = {id(control) for control in (submit, next_control, analysis.text_input) if control}
    explicit_options = [
        control for control in visible
        if control.control_type in OPTION_TYPES and id(control) not in used and not _ignored_label(control.text)
    ]
    button_candidates = [
        control for control in visible
        if control.control_type in ACTION_TYPES and id(control) not in used and not _ignored_label(control.text)
    ]
    options = explicit_options or (button_candidates if len(button_candidates) >= 2 else [])
    analysis.options = sorted(options, key=lambda control: (control.y, control.x))
    used.update(id(control) for control in analysis.options)

    question_controls = [
        control for control in visible
        if id(control) not in used
        and control.control_type in TEXT_TYPES
        and not _is_completion(control.text)
        and not _is_feedback(control.text)
        and not _is_timer(control.text)
    ]
    question_text, question_confidence = _question_from(question_controls, analysis.options, source)
    analysis.question_text = question_text
    analysis.completion_visible = any(
        control.control_type in TEXT_TYPES and id(control) not in used and _is_completion(control.text)
        for control in visible
    )
    feedback_controls = [
        control for control in visible
        if (
            id(control) not in used
            and control.control_type in TEXT_TYPES
            and normalize_text(control.text) != question_text
        )
    ]
    _read_feedback(feedback_controls, analysis)
    if analysis.options:
        multi = any(control.control_type == "CheckBox" for control in analysis.options) or bool(
            re.search(r"\b(select|choose)\s+(all|multiple|two|three|four|\d+|up to)\b", question_text, re.IGNORECASE)
        )
        analysis.question_type = "multiple_select" if multi else "multiple_choice"
    elif analysis.text_input:
        analysis.question_type = (
            "programming"
            if re.search(r"\b(code|function|program|algorithm)\b", question_text, re.IGNORECASE)
            else None
        )

    confidences = [
        question_confidence,
        *(control.confidence for control in analysis.options),
        *(control.confidence for control in (analysis.submit_control, analysis.next_control) if control),
    ]
    base = sum(confidences) / len(confidences) if confidences else 0.0
    if question_text and (len(analysis.options) >= 2 or analysis.text_input):
        analysis.confidence = min(0.98, base) if source == "uia" else min(0.95, base * 0.92)
    elif question_text:
        analysis.confidence = min(0.65, base)
    fingerprint_source = "|".join([
        question_text,
        *(normalize_text(control.text).casefold() for control in analysis.options),
        "input" if analysis.text_input else "no-input",
    ])
    analysis.fingerprint = hashlib.sha256(fingerprint_source.encode("utf-8")).hexdigest()
    analysis.metadata = {"control_count": len(visible), "input_control_count": len(inputs), "analysis_source": source}
    return analysis


def _find_action(controls: list[LiveControl], pattern: re.Pattern[str]) -> LiveControl | None:
    candidates = [
        control for control in controls
        if control.control_type in ACTION_TYPES and pattern.search(normalize_text(control.text)) and control.enabled
    ]
    return candidates[0] if len(candidates) == 1 else None


def _ignored_label(value: str) -> bool:
    return normalize_text(value).casefold() in IGNORED_BUTTON_LABELS


def _question_from(
    controls: list[LiveControl], options: list[LiveControl], source: str
) -> tuple[str, float]:
    scored = [(control, _question_score(control.text)) for control in controls]
    scored = [(control, score) for control, score in scored if score > 0]
    if not scored:
        return "", 0.0
    if source == "ocr" and options:
        first_option_y = min(control.y for control in options)
        preceding = [(control, score) for control, score in scored if control.y < first_option_y]
        if preceding:
            preceding.sort(key=lambda item: (item[0].y, item[0].x))
            selected = preceding[-4:]
            return normalize_text(" ".join(control.text for control, _ in selected)), min(
                control.confidence for control, _ in selected
            )
    control, _score = max(scored, key=lambda item: (item[1], -item[0].y, len(item[0].text)))
    return normalize_text(control.text), control.confidence


def _question_score(value: str) -> int:
    text = normalize_text(value)
    if len(text) < 4 or text.isnumeric():
        return 0
    score = 0
    if "?" in text:
        score += 5
    if QUESTION_WORDS.search(text):
        score += 3
    if re.search(r"\d\s*[-+×x*/=]\s*\d", text):
        score += 4
    if len(text) >= 20:
        score += 2
    if len(text) >= 60:
        score += 1
    return score


def _is_timer(value: str) -> bool:
    text = normalize_text(value)
    if len(text) > 60 or "?" in text:
        return False
    if re.search(r"\b\d{1,3}:\d{2}(?::\d{2})?\b", text):
        return True
    labelled_seconds = re.search(r"\b(time|timer|remaining|countdown)\b", text, re.IGNORECASE)
    return bool(labelled_seconds and re.search(r"\b\d{1,4}\b", text))


def _find_timer(controls: list[LiveControl], source: str) -> TimerData:
    for control in controls:
        if control.control_type in TEXT_TYPES and _is_timer(control.text):
            return parse_timer(control.text, method=source, confidence=control.confidence)
    return TimerData(status=TimerStatus.absent, method=source)


def _is_completion(value: str) -> bool:
    return "?" not in value and bool(COMPLETE_PATTERN.search(normalize_text(value)))


def _is_feedback(value: str) -> bool:
    text = normalize_text(value)
    if len(text) > 160 or "?" in text:
        return False
    lowered = text.casefold()
    markers = ("incorrect", "not correct", "wrong answer", "correct answer", "correct!", "right answer")
    return any(marker in lowered for marker in markers) or lowered == "correct"


def _read_feedback(controls: list[LiveControl], analysis: LiveAnalysis) -> None:
    for control in controls:
        text = normalize_text(control.text)
        if not _is_feedback(text):
            continue
        lowered = text.casefold()
        if any(marker in lowered for marker in ("incorrect", "not correct", "wrong answer")):
            analysis.feedback_outcome = "incorrect"
            analysis.feedback_text = text
            analysis.feedback_confidence = control.confidence
            return
        if any(marker in lowered for marker in ("correct answer", "correct!", "right answer")) or lowered == "correct":
            analysis.feedback_outcome = "correct"
            analysis.feedback_text = text
            analysis.feedback_confidence = control.confidence
            return
