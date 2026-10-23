from __future__ import annotations

import csv
import io
import json
import statistics
from typing import Any

from ..metrics.calculations import calculate_summary, percentile
from ..services.repository import Repository, question_to_schema, run_to_schema


class ReportService:
    def __init__(self, repository: Repository) -> None:
        self.repository = repository

    def build_report(self, run_id: str) -> dict[str, Any] | None:
        run = self.repository.get_run(run_id, with_questions=True)
        if not run:
            return None
        questions = list(run.question_results)
        return {
            "run": run_to_schema(run).model_dump(mode="json"),
            "summary": calculate_summary(run, questions),
            "questions": [question_to_schema(question).model_dump(mode="json") for question in questions],
        }

    def export(self, run_id: str, export_format: str) -> tuple[str, str] | None:
        report = self.build_report(run_id)
        if report is None:
            return None
        if export_format == "json":
            return json.dumps(report, indent=2, ensure_ascii=False), "application/json"
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "run_id", "sequence", "question_id", "question_type", "final_status",
            "failure_category", "timer_status", "timer_seconds", "solver_method",
            "proposed_answer", "total_question_ms", "extraction_ms", "solver_ms",
            "selection_ms", "submission_ms", "ui_response_ms", "verification_ms",
            "navigation_ms", "assertions", "error_details",
        ])
        for question in report["questions"]:
            timings = question.get("stage_timings") or {}
            timer = question.get("timer_data") or {}
            writer.writerow([
                run_id,
                question["sequence"],
                question.get("question_identifier") or "",
                question.get("question_type"),
                question.get("final_status"),
                question.get("failure_category") or "",
                timer.get("status") or "",
                timer.get("seconds") if timer.get("seconds") is not None else "",
                question.get("solver_method") or "",
                json.dumps(question.get("proposed_answer"), ensure_ascii=False) if question.get("proposed_answer") else "",
                timings.get("total_question_ms") if timings.get("total_question_ms") is not None else "",
                timings.get("extraction_ms") if timings.get("extraction_ms") is not None else "",
                timings.get("solver_ms") if timings.get("solver_ms") is not None else "",
                timings.get("selection_ms") if timings.get("selection_ms") is not None else "",
                timings.get("submission_ms") if timings.get("submission_ms") is not None else "",
                timings.get("ui_response_ms") if timings.get("ui_response_ms") is not None else "",
                timings.get("verification_ms") if timings.get("verification_ms") is not None else "",
                timings.get("navigation_ms") if timings.get("navigation_ms") is not None else "",
                json.dumps(question.get("assertions"), ensure_ascii=False),
                question.get("error_details") or "",
            ])
        return output.getvalue(), "text/csv; charset=utf-8"

    def overview(self) -> dict[str, Any]:
        projects, total_projects, _ = self.repository.list_projects(limit=10_000, offset=0)
        runs, total_runs = self.repository.list_runs(limit=1_000, offset=0)
        detailed = [self.repository.get_run(run.id, with_questions=True) for run in runs]
        detailed = [run for run in detailed if run is not None]
        questions = [question for run in detailed for question in run.question_results]
        executed = [question for question in questions if question.final_status not in {"pending", "skipped"}]
        latencies = [
            question.stage_timings.get("total_question_ms")
            for question in executed
            if question.stage_timings and question.stage_timings.get("total_question_ms") is not None
        ]
        assertions = [assertion for question in questions for assertion in question.assertions]
        correctness = [item for item in assertions if item.name == "independent_correctness" and item.status != "unknown"]
        verified = [item for item in correctness if item.status == "passed"]
        failures = sorted(
            [question for question in questions if question.final_status in {"failed", "timeout", "error"}],
            key=lambda item: item.created_at,
            reverse=True,
        )[:6]
        run_by_id = {run.id: run for run in detailed}
        trends = []
        for run in sorted(detailed, key=lambda item: item.started_at)[-12:]:
            summary = calculate_summary(run, list(run.question_results))
            trends.append({
                "run_id": run.id,
                "started_at": run.started_at.isoformat(),
                "label": run.id[:8],
                "pass_rate": summary["pass_rate"],
                "p95_latency_ms": summary["p95_total_latency_ms"],
            })
        return {
            "total_projects": total_projects,
            "total_runs": total_runs,
            "recent_runs": [run_to_schema(run).model_dump(mode="json") for run in runs[:6]],
            "passed_questions": sum(question.final_status == "passed" for question in questions),
            "failed_questions": sum(question.final_status in {"failed", "error"} for question in questions),
            "timeout_rate": round(sum(question.final_status == "timeout" for question in executed) / len(executed), 4) if executed else None,
            "verified_correctness_rate": round(len(verified) / len(correctness), 4) if correctness else None,
            "average_latency_ms": statistics.fmean(latencies) if latencies else None,
            "p95_latency_ms": percentile(latencies, 0.95),
            "recent_failures": [
                {
                    "run_id": question.run_id,
                    "project_name": run_by_id[question.run_id].project.name if run_by_id.get(question.run_id) and run_by_id[question.run_id].project else None,
                    "question_id": question.question_identifier,
                    "sequence": question.sequence,
                    "status": question.final_status,
                    "failure_category": question.failure_category,
                    "error": question.error_details,
                }
                for question in failures
            ],
            "performance_trends": trends,
        }
