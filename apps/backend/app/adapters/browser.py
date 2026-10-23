from __future__ import annotations

import asyncio
import time
from typing import Any
from urllib.parse import urlsplit

from ..schemas.domain import (
    InteractionResult,
    NavigationResult,
    ProposedAnswer,
    TimerData,
    TimerStatus,
    VerificationObservation,
)
from ..services.normalization import parse_timer
from ..services.target_policy import TargetPolicy, TargetPolicyError
from .base import (
    ExtractionError,
    InteractionError,
    NavigationError,
    QuizAdapter,
    RawExtraction,
    SubmissionError,
)

try:
    from playwright.async_api import Error as PlaywrightError
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError
    from playwright.async_api import async_playwright
except ImportError:  # Availability is reported without breaking non-browser API tests.
    PlaywrightError = RuntimeError
    PlaywrightTimeoutError = asyncio.TimeoutError
    async_playwright = None


class BrowserAdapter(QuizAdapter):
    def __init__(
        self,
        *,
        target_url: str,
        selectors: dict[str, str],
        operation_timeout_ms: int,
        feedback_timeout_ms: int,
        headless: bool = False,
        executable_path: str | None = None,
        target_policy: TargetPolicy,
    ) -> None:
        self.target_url = target_url
        self.selectors = selectors
        self.operation_timeout_ms = operation_timeout_ms
        self.feedback_timeout_ms = feedback_timeout_ms
        self.headless = headless
        self.executable_path = executable_path
        self.target_policy = target_policy
        self._playwright: Any = None
        self.browser: Any = None
        self.context: Any = None
        self.page: Any = None
        self.page_errors: list[str] = []
        self.navigation_error: str | None = None
        self._navigation_tasks: set[asyncio.Task[Any]] = set()

    async def start(self) -> float:
        if async_playwright is None:
            raise ExtractionError("Playwright is not installed; install backend requirements and Chromium")
        started = time.perf_counter()
        try:
            await self.target_policy.validate_url(self.target_url)
            self._playwright = await async_playwright().start()
            launch_options: dict[str, Any] = {"headless": self.headless}
            if self.executable_path:
                launch_options["executable_path"] = self.executable_path
            self.browser = await self._playwright.chromium.launch(**launch_options)
            self.context = await self.browser.new_context(viewport={"width": 1280, "height": 800})
            self.context.set_default_timeout(self.operation_timeout_ms)
            self.page = await self.context.new_page()
            self.page.set_default_timeout(self.operation_timeout_ms)
            self.page.on("pageerror", self._on_page_error)
            self.page.on("framenavigated", self._on_frame_navigated)
            await self.context.route("**/*", self._guard_request)
            response = await self.page.goto(
                self.target_url,
                wait_until="domcontentloaded",
                timeout=self.operation_timeout_ms,
            )
            if response and response.status >= 400:
                raise ExtractionError(f"Target returned HTTP {response.status}")
            await self.target_policy.validate_url(self.page.url)
            if self.navigation_error:
                raise ExtractionError(self.navigation_error)
            await self.page.locator(self.selectors["question_root"]).wait_for(
                state="visible", timeout=self.operation_timeout_ms
            )
            return (time.perf_counter() - started) * 1000
        except (PlaywrightError, asyncio.TimeoutError, TargetPolicyError) as exc:
            await self.close()
            if isinstance(exc, TargetPolicyError):
                raise
            raise ExtractionError(f"Browser startup failed: {self._clean_error(exc)}") from exc

    async def inspect(self) -> RawExtraction:
        started = time.perf_counter()
        self._ensure_available()
        try:
            root = self.page.locator(self.selectors["question_root"])
            await root.wait_for(state="visible", timeout=self.operation_timeout_ms)
            question = self.page.locator(self.selectors["question"])
            await question.wait_for(state="visible", timeout=self.operation_timeout_ms)
            text = (await question.inner_text()).strip()
            question_id = await root.get_attribute("data-question-id")
            question_type = await root.get_attribute("data-question-type")
            options = []
            option_locator = self.page.locator(self.selectors["options"])
            for index in range(await option_locator.count()):
                option = option_locator.nth(index)
                label = (await option.inner_text()).strip()
                value = (await option.get_attribute("data-value")) or label
                option_id = await option.get_attribute("data-option-id")
                options.append({"id": option_id, "label": label, "value": value})
            if question_type in {"multiple_choice", "multiple_select"} and not options:
                raise ExtractionError("Configured choice question is missing its answer options")

            timer_started = time.perf_counter()
            timer = await self._read_timer()
            timer_parsing_ms = (time.perf_counter() - timer_started) * 1000
            code_language = None
            code_answer = self.page.locator(self.selectors["code_answer"])
            if await code_answer.count():
                code_language = await code_answer.first.get_attribute("data-language")
            duration = (time.perf_counter() - started) * 1000
            return RawExtraction(
                question_id=question_id,
                text=text,
                question_type=question_type,
                options=options,
                code_language=code_language,
                timer=timer,
                confidence=1.0,
                metadata={
                    "extraction_duration_ms": duration,
                    "timer_parsing_ms": timer_parsing_ms,
                    "page_errors": list(self.page_errors),
                },
            )
        except ExtractionError:
            raise
        except (PlaywrightError, asyncio.TimeoutError) as exc:
            raise ExtractionError(f"Question extraction failed: {self._clean_error(exc)}") from exc

    async def _read_timer(self) -> TimerData:
        locator = self.page.locator(self.selectors["timer"])
        try:
            if not await locator.count() or not await locator.first.is_visible():
                return TimerData(status=TimerStatus.absent, method="dom", confidence=1.0)
            raw = await locator.first.inner_text(timeout=self.operation_timeout_ms)
            return parse_timer(raw, method="dom", confidence=1.0)
        except (PlaywrightError, asyncio.TimeoutError) as exc:
            return TimerData(
                status=TimerStatus.failed,
                method="dom",
                confidence=0,
                error=f"Timer extraction failed: {self._clean_error(exc)}",
            )

    async def select_answer(self, answer: ProposedAnswer) -> InteractionResult:
        started = time.perf_counter()
        self._ensure_available()
        try:
            if answer.kind == "options":
                if not answer.options:
                    raise InteractionError("Solver returned no options to select")
                actual: list[str] = []
                for desired in answer.options:
                    option = await self._find_option(desired)
                    input_control = option.locator("input")
                    if await input_control.count() and await input_control.is_checked():
                        pass
                    else:
                        await option.click(timeout=self.operation_timeout_ms)
                    selected = await self._option_is_selected(option)
                    if not selected:
                        raise InteractionError(f"Option {desired!r} did not become selected in the UI")
                    actual.append((await option.get_attribute("data-value")) or desired)
            elif answer.kind == "text":
                if answer.text is None:
                    raise InteractionError("Text answer is missing")
                field = self.page.locator(self.selectors["text_answer"])
                await field.wait_for(state="visible", timeout=self.operation_timeout_ms)
                await field.fill(answer.text)
                actual = await field.input_value()
                if actual != answer.text:
                    raise InteractionError("Text field value did not match the intended answer")
            elif answer.kind == "code":
                if answer.code is None:
                    raise InteractionError("Code answer is missing")
                field = self.page.locator(self.selectors["code_answer"])
                await field.wait_for(state="visible", timeout=self.operation_timeout_ms)
                await field.fill(answer.code)
                actual = await field.input_value()
                if actual != answer.code:
                    raise InteractionError("Code editor value did not match the intended answer")
            else:
                raise InteractionError("Unsupported answer kind")
            return InteractionResult(
                success=True,
                actual=actual,
                duration_ms=(time.perf_counter() - started) * 1000,
            )
        except InteractionError:
            raise
        except (PlaywrightError, asyncio.TimeoutError) as exc:
            raise InteractionError(f"Answer interaction failed: {self._clean_error(exc)}") from exc

    async def _find_option(self, desired: str) -> Any:
        options = self.page.locator(self.selectors["options"])
        normalized = desired.strip().casefold()
        for index in range(await options.count()):
            option = options.nth(index)
            value = ((await option.get_attribute("data-value")) or "").strip().casefold()
            label = (await option.inner_text()).strip().casefold()
            if normalized in {value, label}:
                return option
        raise InteractionError(f"Intended option {desired!r} was not found; no positional fallback was used")

    @staticmethod
    async def _option_is_selected(option: Any) -> bool:
        input_control = option.locator("input")
        if await input_control.count():
            return await input_control.is_checked()
        return (await option.get_attribute("aria-selected")) == "true" or (await option.get_attribute("data-selected")) == "true"

    async def submit(self) -> InteractionResult:
        started = time.perf_counter()
        self._ensure_available()
        try:
            button = self.page.locator(self.selectors["submit"])
            await button.wait_for(state="visible", timeout=self.operation_timeout_ms)
            await button.click(timeout=self.operation_timeout_ms)
            await self.page.wait_for_function(
                """([rootSelector, feedbackSelector, submitSelector]) => {
                    const root = document.querySelector(rootSelector);
                    const feedback = document.querySelector(feedbackSelector);
                    const submit = document.querySelector(submitSelector);
                    const feedbackVisible = feedback && !!(feedback.offsetWidth || feedback.offsetHeight || feedback.getClientRects().length);
                    return (root && root.dataset.submitted === 'true') || feedbackVisible || (submit && submit.disabled);
                }""",
                arg=[self.selectors["question_root"], self.selectors["feedback"], self.selectors["submit"]],
                timeout=self.operation_timeout_ms,
            )
            root = self.page.locator(self.selectors["question_root"])
            actual = {
                "submitted_attribute": await root.get_attribute("data-submitted"),
                "submit_disabled": await button.is_disabled(),
            }
            return InteractionResult(success=True, actual=actual, duration_ms=(time.perf_counter() - started) * 1000)
        except (PlaywrightError, asyncio.TimeoutError) as exc:
            raise SubmissionError(f"Submission could not be observed: {self._clean_error(exc)}") from exc

    async def wait_for_result(self) -> VerificationObservation:
        started = time.perf_counter()
        self._ensure_available()
        feedback = self.page.locator(self.selectors["feedback"])
        try:
            await feedback.wait_for(state="visible", timeout=self.feedback_timeout_ms)
            outcome = (await feedback.get_attribute("data-outcome")) or "unknown"
            if outcome not in {"correct", "incorrect", "unknown"}:
                outcome = "unknown"
            return VerificationObservation(
                feedback_visible=True,
                outcome=outcome,
                text=(await feedback.inner_text()).strip()[:2_000],
                duration_ms=(time.perf_counter() - started) * 1000,
            )
        except (PlaywrightTimeoutError, asyncio.TimeoutError):
            return VerificationObservation(
                feedback_visible=False,
                duration_ms=(time.perf_counter() - started) * 1000,
                timed_out=True,
                error="Feedback did not appear before the configured deadline",
            )
        except PlaywrightError as exc:
            return VerificationObservation(
                feedback_visible=False,
                duration_ms=(time.perf_counter() - started) * 1000,
                error=f"Feedback observation failed: {self._clean_error(exc)}",
            )

    async def next_question(self) -> NavigationResult:
        started = time.perf_counter()
        self._ensure_available()
        try:
            complete = self.page.locator(self.selectors["complete"])
            if await complete.count() and await complete.is_visible():
                return NavigationResult(success=True, has_next=False, duration_ms=(time.perf_counter() - started) * 1000)
            root = self.page.locator(self.selectors["question_root"])
            old_id = await root.get_attribute("data-question-id")
            button = self.page.locator(self.selectors["next"])
            if not await button.count() or not await button.is_enabled():
                if await complete.count() and await complete.is_visible():
                    return NavigationResult(success=True, has_next=False, duration_ms=(time.perf_counter() - started) * 1000)
                raise NavigationError("Next control is unavailable and no completion state was shown")
            await button.click(timeout=self.operation_timeout_ms)
            await self.page.wait_for_function(
                """([rootSelector, completeSelector, oldId]) => {
                    const root = document.querySelector(rootSelector);
                    const complete = document.querySelector(completeSelector);
                    const completeVisible = complete && !!(complete.offsetWidth || complete.offsetHeight || complete.getClientRects().length);
                    return completeVisible || (root && root.dataset.questionId !== oldId);
                }""",
                arg=[self.selectors["question_root"], self.selectors["complete"], old_id],
                timeout=self.operation_timeout_ms,
            )
            has_next = not (await complete.count() and await complete.is_visible())
            new_id = await root.get_attribute("data-question-id") if has_next else None
            return NavigationResult(
                success=True,
                has_next=has_next,
                question_id=new_id,
                duration_ms=(time.perf_counter() - started) * 1000,
            )
        except NavigationError:
            raise
        except (PlaywrightError, asyncio.TimeoutError) as exc:
            raise NavigationError(f"Navigation verification failed: {self._clean_error(exc)}") from exc

    async def close(self) -> None:
        for task in list(self._navigation_tasks):
            task.cancel()
        for resource in (self.context, self.browser):
            if resource is not None:
                try:
                    await resource.close()
                except Exception:
                    pass
        self.context = None
        self.browser = None
        self.page = None
        if self._playwright is not None:
            try:
                await self._playwright.stop()
            except Exception:
                pass
            self._playwright = None

    async def _guard_request(self, route: Any) -> None:
        url = route.request.url
        if urlsplit(url).scheme not in {"http", "https"}:
            await route.continue_()
            return
        try:
            await self.target_policy.validate_url(url)
            await route.continue_()
        except TargetPolicyError as exc:
            self.navigation_error = f"Blocked unauthorized target request: {type(exc).__name__}"
            await route.abort("blockedbyclient")

    async def _on_frame_navigated(self, frame: Any) -> None:
        if frame != self.page.main_frame or urlsplit(frame.url).scheme not in {"http", "https"}:
            return
        task = asyncio.create_task(self._validate_navigation(frame.url))
        self._navigation_tasks.add(task)
        task.add_done_callback(self._navigation_tasks.discard)

    async def _validate_navigation(self, url: str) -> None:
        try:
            await self.target_policy.validate_url(url)
        except TargetPolicyError as exc:
            self.navigation_error = f"Unauthorized navigation blocked: {exc}"

    def _on_page_error(self, error: Any) -> None:
        # Page errors are capped and sanitized; page content and storage are not captured.
        if len(self.page_errors) < 20:
            self.page_errors.append(self._clean_error(error))

    def _ensure_available(self) -> None:
        if self.page is None:
            raise ExtractionError("Browser target is unavailable")
        if self.navigation_error:
            raise ExtractionError(self.navigation_error)

    @staticmethod
    def _clean_error(error: Any) -> str:
        return " ".join(str(error).split())[:800]
