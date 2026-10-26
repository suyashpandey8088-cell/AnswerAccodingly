from fastapi.testclient import TestClient
from app.main import app, COMPANION_TOKEN

client = TestClient(app)


def test_health_endpoint_allows_permitted_origin():
    res = client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_unauthorized_origin_is_blocked():
    res = client.get("/health", headers={"Origin": "https://malicious-external-site.example.com"})
    assert res.status_code == 403
    assert "Unauthorized Origin" in res.json()["detail"]


def test_missing_token_rejected():
    res = client.post(
        "/analyze-question",
        json={
            "questionId": "q1",
            "questionText": "What is CAP theorem?",
            "questionType": "single_choice",
            "options": [{"id": "a", "label": "A", "text": "Consistency and Availability"}],
        },
    )
    assert res.status_code == 401


def test_analyze_question_with_valid_token():
    res = client.post(
        "/analyze-question",
        headers={
            "Origin": "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
            "X-QuizPilot-Token": COMPANION_TOKEN,
        },
        json={
            "questionId": "q_cap",
            "questionText": "According to the CAP theorem, which trade-off occurs?",
            "questionType": "single_choice",
            "options": [
                {"id": "opt_1", "label": "A", "text": "Consistency and Availability"},
                {"id": "opt_2", "label": "B", "text": "None"},
            ],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["proposedAnswers"] == ["opt_1"]
    assert body["isUncertain"] is False


def test_request_size_limit_enforced():
    oversized_text = "x" * (70 * 1024)
    res = client.post(
        "/analyze-question",
        headers={"X-QuizPilot-Token": COMPANION_TOKEN},
        content=oversized_text,
    )
    assert res.status_code == 413


def test_unauthorized_playwright_target_refused():
    res = client.post(
        "/automate-practice",
        headers={"X-QuizPilot-Token": COMPANION_TOKEN},
        json={"targetUrl": "https://live-graded-university-exam.edu/midterm"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "stopped_safety_restriction"
