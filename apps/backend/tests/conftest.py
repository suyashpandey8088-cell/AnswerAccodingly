from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

_TEST_DIR = tempfile.TemporaryDirectory(prefix="quizpilot-tests-")
os.environ["QUIZPILOT_DATABASE_URL"] = f"sqlite:///{Path(_TEST_DIR.name) / 'test.db'}"
os.environ["QUIZPILOT_API_TOKEN"] = "test-session-token"
os.environ["QUIZPILOT_SANDBOX_ENABLED"] = "false"

from fastapi.testclient import TestClient  # noqa: E402

from app.config import Settings  # noqa: E402
from app.database import Base, engine, init_db  # noqa: E402
from app.main import create_app  # noqa: E402


def pytest_addoption(parser):
    parser.addoption("--run-browser", action="store_true", default=False, help="Run integration tests requiring Chromium")
    parser.addoption("--run-desktop", action="store_true", default=False, help="Run tests requiring a visible desktop")
    parser.addoption("--run-sandbox", action="store_true", default=False, help="Run tests requiring Docker isolation")


@pytest.fixture(autouse=True)
def clean_database():
    Base.metadata.drop_all(bind=engine)
    init_db()
    yield


@pytest.fixture
def settings() -> Settings:
    return Settings(api_token="test-session-token", database_url=os.environ["QUIZPILOT_DATABASE_URL"])


@pytest.fixture
def client(settings):
    app = create_app(settings)
    with TestClient(app) as test_client:
        test_client.headers.update({"X-QuizPilot-Token": "test-session-token"})
        yield test_client


@pytest.fixture
def browser_enabled(request):
    if not request.config.getoption("--run-browser"):
        pytest.skip("Pass --run-browser after installing Chromium to run this integration test")


@pytest.fixture
def desktop_enabled(request):
    if not request.config.getoption("--run-desktop"):
        pytest.skip("Graphical desktop tests require --run-desktop")


@pytest.fixture
def sandbox_enabled(request):
    if not request.config.getoption("--run-sandbox"):
        pytest.skip("Real sandbox tests require --run-sandbox and Docker")
