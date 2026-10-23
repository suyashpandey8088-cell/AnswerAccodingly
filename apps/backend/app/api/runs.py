from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Query, Request, Response, status
from fastapi.responses import StreamingResponse

from ..schemas.run import RunCreate, RunDetail, RunList, RunReport, TestRunRead
from ..services.repository import question_to_schema, run_to_schema
from .errors import APIError
from .projects import config_from_project

router = APIRouter(prefix="/api/runs", tags=["runs"])


@router.post("", response_model=TestRunRead, status_code=status.HTTP_202_ACCEPTED)
async def create_run(payload: RunCreate, request: Request) -> TestRunRead:
    repository = request.app.state.repository
    project = repository.get_project(payload.project_id)
    if not project:
        raise APIError(404, "project_not_found", "Project was not found")
    config = config_from_project(project)
    validation = await request.app.state.environment_validator.validate(config, payload.operator_confirmed)
    if not validation["valid"]:
        raise APIError(
            409,
            "environment_validation_failed",
            "The target environment is not ready; no fallback target was selected",
            {"checks": validation["checks"]},
        )
    snapshot = {
        "project": config.model_dump(mode="json"),
        "operator_confirmed_at": datetime.now(timezone.utc).isoformat(),
    }
    run = repository.create_run(project, snapshot)
    await request.app.state.run_manager.start_run(run.id)
    return run_to_schema(run, project.name)


@router.get("", response_model=RunList)
def list_runs(
    request: Request,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    project_id: str | None = None,
) -> RunList:
    runs, total = request.app.state.repository.list_runs(limit, offset, project_id)
    return RunList(
        items=[run_to_schema(run) for run in runs],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{run_id}", response_model=RunDetail)
def get_run(run_id: str, request: Request) -> RunDetail:
    run = request.app.state.repository.get_run(run_id, with_questions=True)
    if not run:
        raise APIError(404, "run_not_found", "Run was not found")
    schema = run_to_schema(run)
    return RunDetail(
        **schema.model_dump(),
        question_results=[question_to_schema(question) for question in run.question_results],
    )


@router.post("/{run_id}/cancel", response_model=TestRunRead)
async def cancel_run(run_id: str, request: Request) -> TestRunRead:
    run = request.app.state.repository.get_run(run_id, with_questions=False)
    if not run:
        raise APIError(404, "run_not_found", "Run was not found")
    if run.status not in {"pending", "running"}:
        raise APIError(409, "run_not_active", "Only pending or running runs can be cancelled")
    cancelled = await request.app.state.run_manager.cancel_run(run_id)
    if not cancelled:
        raise APIError(409, "cancellation_failed", "The run could not be cancelled cleanly")
    run = request.app.state.repository.get_run(run_id, with_questions=False)
    return run_to_schema(run)


@router.get("/{run_id}/events")
async def stream_run_events(run_id: str, request: Request) -> StreamingResponse:
    if not request.app.state.repository.get_run(run_id, with_questions=False):
        raise APIError(404, "run_not_found", "Run was not found")
    return StreamingResponse(
        request.app.state.events.stream(run_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{run_id}/report", response_model=RunReport)
def get_report(run_id: str, request: Request) -> RunReport:
    report = request.app.state.report_service.build_report(run_id)
    if not report:
        raise APIError(404, "run_not_found", "Run was not found")
    return report


@router.get("/{run_id}/export")
def export_report(run_id: str, request: Request, format: Literal["json", "csv"] = "json") -> Response:
    exported = request.app.state.report_service.export(run_id, format)
    if not exported:
        raise APIError(404, "run_not_found", "Run was not found")
    content, media_type = exported
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="quizpilot-{run_id}.{format}"'},
    )
