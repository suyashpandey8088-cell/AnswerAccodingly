from __future__ import annotations

import asyncio
import importlib.util
from pathlib import Path

from sqlalchemy import text

from ..database import SessionLocal
from typing import Any

from ..adapters.desktop import desktop_availability
from ..config import Settings
from ..schemas.project import ProjectCreate
from .target_policy import TargetPolicy, TargetPolicyError

try:
    from playwright.async_api import async_playwright
except ImportError:
    async_playwright = None


class EnvironmentValidator:
    def __init__(self, settings: Settings, target_policy: TargetPolicy) -> None:
        self.settings = settings
        self.target_policy = target_policy

    async def validate(self, project: ProjectCreate, operator_confirmed: bool = False) -> dict[str, Any]:
        checks: list[dict[str, Any]] = []

        def add(name: str, passed: bool, detail: str) -> None:
            checks.append({"name": name, "passed": passed, "detail": detail})

        add("target_configuration", True, "Project configuration passed schema validation")
        try:
            healthy = await asyncio.to_thread(self._database_healthy)
            add("backend_health", healthy, "Backend and SQLite health check passed" if healthy else "SQLite health check failed")
        except Exception:
            add("backend_health", False, "Backend database health check failed")
        if project.adapter_type == "browser":
            try:
                target = await self.target_policy.validate_url(project.target_config.url or "")
                add("authorized_target", True, f"Allowed host {target.hostname}; resolved addresses validated")
            except TargetPolicyError as exc:
                add("authorized_target", False, str(exc))
            playwright_installed = importlib.util.find_spec("playwright") is not None
            add("playwright_installed", playwright_installed, "Playwright Python package is available" if playwright_installed else "Install backend requirements")
            browser_available, browser_detail = await self.browser_available()
            add("chromium_available", browser_available, browser_detail)
        else:
            availability = desktop_availability()
            add("desktop_ocr_and_input", availability["available"], availability["detail"])
            add(
                "calibrated_regions",
                {"question", "answer", "submit"}.issubset(project.target_config.regions),
                "Question, answer and submit regions must be explicitly calibrated",
            )
        add(
            "operator_confirmation",
            bool(operator_confirmed and project.safety_settings.operator_confirmed),
            "Both project authorization and the immediate run confirmation are required",
        )
        add(
            "submission_authorized",
            project.safety_settings.allow_submit,
            "Submission is enabled explicitly; when disabled, runs are inspect/select only",
        )
        # Submission authorization is a capability check, not a requirement to submit.
        valid = all(check["passed"] for check in checks if check["name"] != "submission_authorized")
        return {"valid": valid, "checks": checks}

    @staticmethod
    def _database_healthy() -> bool:
        with SessionLocal() as session:
            return session.execute(text("SELECT 1")).scalar() == 1

    async def browser_available(self) -> tuple[bool, str]:
        if self.settings.browser_executable_path:
            exists = Path(self.settings.browser_executable_path).is_file()
            return exists, "Configured Chromium executable was found" if exists else "Configured Chromium executable does not exist"
        if async_playwright is None:
            return False, "Playwright is unavailable"
        driver = None
        try:
            driver = await async_playwright().start()
            executable = Path(driver.chromium.executable_path)
            exists = executable.is_file()
            return exists, "Playwright Chromium is installed" if exists else f"Chromium is not installed; run: playwright install chromium"
        except Exception as exc:
            return False, f"Playwright driver check failed: {type(exc).__name__}"
        finally:
            if driver:
                await driver.stop()
