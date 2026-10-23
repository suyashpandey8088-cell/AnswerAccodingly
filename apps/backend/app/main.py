from __future__ import annotations

import secrets
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from .api.errors import APIError, error_body
from .api.projects import router as projects_router
from .api.runs import router as runs_router
from .api.system import router as system_router
from .config import REPOSITORY_DIR, Settings, get_settings
from .database import SessionLocal, init_db
from .reports.service import ReportService
from .sandbox.docker_sandbox import DockerSandbox
from .services.environment import EnvironmentValidator
from .services.events import EventHub
from .services.repository import Repository
from .services.runner import RunManager
from .services.target_policy import TargetPolicy
from .solvers.deterministic import DeterministicSolver
from .solvers.engine import SolverEngine
from .solvers.llm import LLMSolver

VERSION = "0.1.0"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        init_db()
        repository = Repository()
        repository.recover_interrupted_runs()
        target_policy = TargetPolicy(settings)
        events = EventHub()
        sandbox = DockerSandbox(
            enabled=settings.sandbox_enabled,
            image=settings.sandbox_image,
            timeout_seconds=settings.sandbox_timeout_seconds,
        )
        llm = LLMSolver(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
            model=settings.llm_model,
            timeout_seconds=settings.llm_timeout_seconds,
            max_retries=settings.llm_max_retries,
        )
        solver_engine = SolverEngine(DeterministicSolver(), llm, sandbox)
        app.state.settings = settings
        app.state.repository = repository
        app.state.target_policy = target_policy
        app.state.events = events
        app.state.sandbox = sandbox
        app.state.solver_engine = solver_engine
        app.state.report_service = ReportService(repository)
        app.state.environment_validator = EnvironmentValidator(settings, target_policy)
        app.state.run_manager = RunManager(
            repository=repository,
            settings=settings,
            solver_engine=solver_engine,
            target_policy=target_policy,
            events=events,
        )
        yield
        await app.state.run_manager.shutdown()

    app = FastAPI(
        title="QuizPilot AI API",
        version=VERSION,
        description="Local QA automation for explicitly authorized quiz environments",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-QuizPilot-Token", "Authorization"],
        expose_headers=["Content-Disposition"],
    )

    @app.middleware("http")
    async def local_security(request: Request, call_next):
        if request.headers.get("content-length"):
            try:
                if int(request.headers["content-length"]) > 1_000_000:
                    return JSONResponse(status_code=413, content=error_body("payload_too_large", "Request body exceeds 1 MB"))
            except ValueError:
                return JSONResponse(status_code=400, content=error_body("invalid_request", "Invalid Content-Length header"))
        origin = request.headers.get("origin")
        if request.method not in {"GET", "HEAD", "OPTIONS"} and origin and origin not in settings.allowed_origins:
            return JSONResponse(status_code=403, content=error_body("origin_rejected", "State-changing request origin is not allowed"))
        if request.url.path.startswith("/api/") and request.method != "OPTIONS":
            supplied = request.headers.get("x-quizpilot-token")
            authorization = request.headers.get("authorization", "")
            if not supplied and authorization.startswith("Bearer "):
                supplied = authorization.removeprefix("Bearer ")
            if not supplied or not secrets.compare_digest(supplied, settings.api_token):
                return JSONResponse(status_code=401, content=error_body("unauthorized", "A valid local QuizPilot session token is required"))
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        if request.url.path.startswith("/demo"):
            response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
        return response

    @app.exception_handler(APIError)
    async def api_error_handler(_request: Request, exc: APIError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=error_body(exc.code, exc.message, exc.details))

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=jsonable_encoder(error_body("validation_error", "Request validation failed", {"fields": exc.errors()})),
        )

    @app.exception_handler(Exception)
    async def unexpected_error_handler(_request: Request, _exc: Exception) -> JSONResponse:
        # Internal details and credentials are not returned to clients or logged by default.
        return JSONResponse(status_code=500, content=error_body("internal_error", "An unexpected backend error occurred"))

    @app.get("/health")
    def health() -> dict:
        try:
            with SessionLocal() as session:
                session.execute(text("SELECT 1"))
            database = "connected"
        except Exception:
            database = "unavailable"
        return {
            "status": "ok" if database == "connected" else "degraded",
            "service": "quizpilot-backend",
            "version": VERSION,
            "database": database,
        }

    app.include_router(system_router)
    app.include_router(projects_router)
    app.include_router(runs_router)

    fixture_dir = REPOSITORY_DIR / "fixtures" / "browser-quiz"
    if fixture_dir.is_dir():
        app.mount("/demo", StaticFiles(directory=fixture_dir, html=True), name="demo-quiz")
    return app


app = create_app()


if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False, log_level="info")
