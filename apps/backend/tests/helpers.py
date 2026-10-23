from app.schemas.domain import AnswerOption, NormalizedQuestion, TimerData, TimerStatus


def make_question(
    text="Which HTTP status code means Not Found?",
    question_type="multiple_choice",
    options=("200", "201", "404", "500"),
    question_id="demo-http-404",
):
    return NormalizedQuestion(
        question_id=question_id,
        text=text,
        question_type=question_type,
        options=[AnswerOption(label=value, value=value) for value in options],
        timer=TimerData(status=TimerStatus.present, raw_text="01:30", seconds=90, method="test", confidence=1),
        extraction_confidence=1,
        source_adapter="browser",
        extraction_duration_ms=1,
    )


def project_payload(**overrides):
    payload = {
        "name": "Local demo QA",
        "adapter_type": "browser",
        "target_config": {
            "url": "http://127.0.0.1:8765/demo/?scenario=normal",
            "oracle_profile": "demo-v1",
            "headless": True,
        },
        "timeout_settings": {"operation_ms": 3000, "feedback_ms": 1000, "run_seconds": 20},
        "solver_settings": {"provider": "deterministic", "timeout_seconds": 2, "max_retries": 0},
        "safety_settings": {
            "allow_submit": True,
            "operator_confirmed": True,
            "max_questions": 6,
            "failure_threshold": 3,
        },
        "question_types": ["multiple_choice", "multiple_select", "math", "logical", "text", "programming"],
    }
    payload.update(overrides)
    return payload
