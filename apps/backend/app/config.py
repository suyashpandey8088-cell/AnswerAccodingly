"""Application configuration. Secrets are supplied by the environment, never committed."""
from functools import lru_cache
from pathlib import Path
import os
import secrets

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPOSITORY_DIR = Path(os.environ.get("QUIZPILOT_REPOSITORY_DIR", str(BACKEND_DIR.parents[1]))).resolve()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="QUIZPILOT_",
        env_file=(".env", BACKEND_DIR / ".env"),
        extra="ignore",
    )

    app_name: str = "QuizPilot AI"
    environment: str = "development"
    host: str = "127.0.0.1"
    port: int = 8765
    database_url: str = f"sqlite:///{BACKEND_DIR / 'data' / 'quizpilot.db'}"
    api_token: str = Field(default_factory=lambda: secrets.token_urlsafe(32))
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,null"
    target_allowlist: str = "localhost,127.0.0.1,::1"
    allow_non_local_targets: bool = False
    default_operation_timeout_ms: int = 10_000
    default_run_timeout_seconds: int = 300
    max_concurrent_runs: int = 2
    browser_headless: bool = False
    browser_executable_path: str | None = None
    llm_api_key: str | None = None
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"
    llm_timeout_seconds: float = 30.0
    llm_max_retries: int = 2
    sandbox_enabled: bool = False
    sandbox_image: str = "python:3.12-alpine"
    sandbox_timeout_seconds: float = 5.0
    diagnostic_artifacts: bool = False
    artifact_retention_hours: int = 24

    @property
    def allowed_origins(self) -> list[str]:
        return [value.strip() for value in self.cors_origins.split(",") if value.strip()]

    @property
    def allowed_targets(self) -> set[str]:
        return {value.strip().lower() for value in self.target_allowlist.split(",") if value.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()
