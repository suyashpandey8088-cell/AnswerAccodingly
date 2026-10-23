import json

from app.reports.service import ReportService
from app.schemas.domain import AssertionOutcome, RunStatus
from app.schemas.project import ProjectCreate
from app.services.repository import Repository
from tests.helpers import make_question, project_payload


def persist_passed_question(repository: Repository):
    project = repository.create_project(ProjectCreate.model_validate(project_payload()))
    config = ProjectCreate.model_validate(project_payload())
    run = repository.create_run(project, {"project": config.model_dump(mode="json")})
    question = make_question()
    values = {
        "question_identifier": question.question_id,
        "question_type": question.question_type,
        "extraction_result": question.model_dump(mode="json"),
        "timer_data": question.timer.model_dump(mode="json"),
        "proposed_answer": {"kind": "options", "options": ["404"]},
        "solver_result": {"status": "solved", "method": "deterministic", "confidence": 1, "duration_ms": 2, "validation_status": "valid", "retry_count": 0, "sandbox_status": "not_required"},
        "solver_method": "deterministic",
        "verification_result": {"observed": True},
        "final_status": "passed",
        "failure_category": None,
        "stage_timings": {"total_question_ms": 100, "extraction_ms": 20, "solver_ms": 2},
        "error_details": None,
        "diagnostic_refs": [],
    }
    assertions = [
        AssertionOutcome(name="question_displayed", expected=True, actual=True, status="passed", explanation="Displayed"),
        AssertionOutcome(name="independent_correctness", expected=True, actual=True, status="passed", explanation="Independent fixture oracle"),
    ]
    saved = repository.save_question(run.id, 1, values, assertions)
    return project, run, saved


def test_incremental_persistence_and_report_export():
    repository = Repository()
    _project, run, saved = persist_passed_question(repository)
    assert saved.id is not None
    finished = repository.finish_run(run.id, RunStatus.passed)
    assert finished.summary_metrics["total_questions"] == 1
    assert finished.summary_metrics["verified_correctness_rate"] == 1
    assert finished.summary_metrics["median_total_latency_ms"] == 100
    assert finished.summary_metrics["p95_total_latency_ms"] == 100

    report = ReportService(repository).build_report(run.id)
    assert report["questions"][0]["question_identifier"] == "demo-http-404"
    assert report["questions"][0]["assertions"][1]["name"] == "independent_correctness"

    json_export, media_type = ReportService(repository).export(run.id, "json")
    assert media_type == "application/json"
    assert json.loads(json_export)["summary"]["passed_assertions"] == 2
    csv_export, media_type = ReportService(repository).export(run.id, "csv")
    assert media_type.startswith("text/csv")
    assert "demo-http-404" in csv_export
    assert "independent_correctness" in csv_export


def test_crash_recovery_marks_run_error_without_erasing_saved_questions():
    repository = Repository()
    _project, run, _saved = persist_passed_question(repository)
    repository.set_run_running(run.id)
    assert repository.recover_interrupted_runs() == 1
    recovered = repository.get_run(run.id)
    assert recovered.status == "error"
    assert len(recovered.question_results) == 1
    assert "retained" in recovered.error_summary


def test_overview_empty_state_has_no_fabricated_metrics():
    overview = ReportService(Repository()).overview()
    assert overview["total_projects"] == 0
    assert overview["total_runs"] == 0
    assert overview["average_latency_ms"] is None
    assert overview["verified_correctness_rate"] is None
    assert overview["recent_failures"] == []
