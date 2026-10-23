from __future__ import annotations

from fastapi import APIRouter, Query, Request, Response, status

from ..schemas.project import ProjectCreate, ProjectList, ProjectRead, ProjectUpdate, project_to_schema
from ..schemas.run import RunCreate
from .errors import APIError

router = APIRouter(prefix="/api/projects", tags=["projects"])


def config_from_project(project) -> ProjectCreate:
    return ProjectCreate(
        name=project.name,
        adapter_type=project.adapter_type,
        target_config=project.target_config,
        selector_config=project.selector_config,
        timeout_settings=project.timeout_settings,
        solver_settings=project.solver_settings,
        safety_settings=project.safety_settings,
        question_types=project.question_types,
    )


@router.get("", response_model=ProjectList)
def list_projects(
    request: Request,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> ProjectList:
    projects, total, last_runs = request.app.state.repository.list_projects(limit, offset)
    return ProjectList(
        items=[project_to_schema(project, last_runs.get(project.id)) for project in projects],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreate, request: Request) -> ProjectRead:
    project = request.app.state.repository.create_project(payload)
    return project_to_schema(project)


@router.get("/{project_id}", response_model=ProjectRead)
def get_project(project_id: str, request: Request) -> ProjectRead:
    repository = request.app.state.repository
    project = repository.get_project(project_id)
    if not project:
        raise APIError(404, "project_not_found", "Project was not found")
    _, _, last_runs = repository.list_projects(limit=100)
    return project_to_schema(project, last_runs.get(project.id))


@router.patch("/{project_id}", response_model=ProjectRead)
def update_project(project_id: str, payload: ProjectUpdate, request: Request) -> ProjectRead:
    repository = request.app.state.repository
    project = repository.get_project(project_id)
    if not project:
        raise APIError(404, "project_not_found", "Project was not found")
    current = config_from_project(project).model_dump()
    current.update(payload.model_dump(exclude_unset=True, mode="json"))
    try:
        validated = ProjectCreate.model_validate(current)
    except ValueError as exc:
        raise APIError(422, "invalid_project", "Updated project configuration is invalid", {"reason": str(exc)}) from exc
    updated = repository.update_project(project_id, validated)
    if not updated:
        raise APIError(404, "project_not_found", "Project was not found")
    return project_to_schema(updated)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: str, request: Request) -> Response:
    repository = request.app.state.repository
    if not repository.get_project(project_id):
        raise APIError(404, "project_not_found", "Project was not found")
    runs, _ = repository.list_runs(limit=100, project_id=project_id)
    if any(run.status in {"pending", "running"} for run in runs):
        raise APIError(409, "active_run", "Cancel active runs before deleting this project")
    repository.delete_project(project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{project_id}/validate")
async def validate_environment(project_id: str, payload: RunCreate, request: Request) -> dict:
    # RunCreate supplies both the project id (which must match) and confirmation.
    if payload.project_id != project_id:
        raise APIError(422, "project_mismatch", "Body project_id must match the path project_id")
    project = request.app.state.repository.get_project(project_id)
    if not project:
        raise APIError(404, "project_not_found", "Project was not found")
    return await request.app.state.environment_validator.validate(
        config_from_project(project), payload.operator_confirmed
    )
