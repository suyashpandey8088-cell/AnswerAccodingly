import sys

from fastapi import APIRouter, Request

from ..adapters.desktop import desktop_availability

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/overview")
def overview(request: Request) -> dict:
    return request.app.state.report_service.overview()


@router.get("/system/status")
async def system_status(request: Request) -> dict:
    browser_available, browser_detail = await request.app.state.environment_validator.browser_available()
    sandbox_available, sandbox_detail = await request.app.state.sandbox.availability()
    return {
        "python_version": sys.version.split()[0],
        "browser": {"available": browser_available, "detail": browser_detail},
        "desktop": desktop_availability(),
        "sandbox": {"available": sandbox_available, "detail": sandbox_detail},
        "llm": {
            "configured": bool(request.app.state.settings.llm_api_key),
            "provider": "openai-compatible",
            "model": request.app.state.settings.llm_model,
            "detail": "Environment credential configured" if request.app.state.settings.llm_api_key else "Optional LLM credential is not configured; deterministic demo solving still works",
        },
        "persistence": "SQLite with incremental per-question commits",
        "target_policy": {
            "allowlisted_hosts": sorted(request.app.state.settings.allowed_targets),
            "loopback_only": not request.app.state.settings.allow_non_local_targets,
        },
    }
