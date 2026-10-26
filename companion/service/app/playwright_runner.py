from urllib.parse import urlparse
from typing import Dict, Any, List

ALLOWED_HOSTS = {"localhost", "127.0.0.1"}


def is_authorized_target_url(target_url: str) -> bool:
    try:
        parsed = urlparse(target_url)
        if parsed.scheme not in {"http", "https"}:
            return False
        host = (parsed.hostname or "").lower()
        return host in ALLOWED_HOSTS
    except Exception:
        return False


async def run_playwright_practice_inspection(
    target_url: str, max_questions: int = 20, timeout_seconds: int = 15
) -> Dict[str, Any]:
    """
    Executes an authorized Playwright practice inspection against a local synthetic quiz page.
    Refuses non-local or unauthorized origins and halts immediately if CAPTCHA/proctoring is detected.
    """
    if not is_authorized_target_url(target_url):
        return {
            "status": "stopped_safety_restriction",
            "reason": "Target URL is not in the authorized local practice allowlist (localhost/127.0.0.1).",
            "questionsInspected": 0,
        }

    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return {
            "status": "unavailable",
            "reason": "Playwright package is not installed in the current environment.",
            "questionsInspected": 0,
        }

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            try:
                page = await browser.new_page()
                await page.goto(target_url, timeout=timeout_seconds * 1000)

                # Check for CAPTCHA or proctoring markers first
                has_restriction = await page.evaluate(
                    """() => Boolean(
                        document.querySelector('.g-recaptcha, .h-captcha, [data-captcha="true"], [data-exam-mode="graded-live"], [data-proctoring="active"]')
                    )"""
                )
                if has_restriction:
                    return {
                        "status": "stopped_safety_restriction",
                        "reason": "CAPTCHA or graded/proctored restriction marker detected on page.",
                        "questionsInspected": 0,
                    }

                is_practice = await page.evaluate(
                    """() => (
                        document.documentElement.getAttribute('data-quizpilot-authorized') === 'true' ||
                        document.documentElement.getAttribute('data-quiz-mode') === 'practice'
                    )"""
                )
                if not is_practice:
                    return {
                        "status": "stopped_safety_restriction",
                        "reason": "Page lacks explicit practice authorization attributes.",
                        "questionsInspected": 0,
                    }

                questions: List[Dict[str, Any]] = await page.evaluate(
                    """(limit) => {
                        const cards = Array.from(document.querySelectorAll('[data-quiz-question]')).slice(0, limit);
                        return cards.map((c, idx) => ({
                            questionId: c.getAttribute('data-question-id') || `q_${idx + 1}`,
                            questionType: c.getAttribute('data-question-type') || 'single_choice',
                            prompt: (c.querySelector('[data-question-prompt]')?.textContent || '').trim()
                        }));
                    }""",
                    max_questions,
                )
                return {
                    "status": "completed",
                    "questionsInspected": len(questions),
                    "questions": questions,
                }
            finally:
                await browser.close()
    except Exception as exc:
        return {
            "status": "failed",
            "reason": f"Playwright browser launch or navigation error: {str(exc)[:200]}",
            "questionsInspected": 0,
        }
