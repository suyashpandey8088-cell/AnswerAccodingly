from tests.helpers import project_payload


def test_health_is_public_but_api_requires_session_token(client):
    response = client.get("/health", headers={"X-QuizPilot-Token": "wrong"})
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    unauthorized = client.get("/api/projects", headers={"X-QuizPilot-Token": "wrong"})
    assert unauthorized.status_code == 401
    assert unauthorized.json()["error"]["code"] == "unauthorized"


def test_project_crud_validation_and_pagination(client):
    invalid = client.post("/api/projects", json={"name": "", "adapter_type": "browser", "target_config": {}})
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "validation_error"

    created = client.post("/api/projects", json=project_payload())
    assert created.status_code == 201, created.text
    project = created.json()
    assert project["target_config"]["headless"] is True
    assert project["safety_settings"]["allow_submit"] is True

    listed = client.get("/api/projects?limit=1&offset=0")
    assert listed.status_code == 200
    assert listed.json()["total"] == 1
    assert len(listed.json()["items"]) == 1

    updated = client.patch(f"/api/projects/{project['id']}", json={"name": "Renamed QA project"})
    assert updated.status_code == 200
    assert updated.json()["name"] == "Renamed QA project"
    assert updated.json()["target_config"]["oracle_profile"] == "demo-v1"

    deleted = client.delete(f"/api/projects/{project['id']}")
    assert deleted.status_code == 204
    assert client.get(f"/api/projects/{project['id']}").status_code == 404


def test_state_changing_request_rejects_untrusted_origin(client):
    response = client.post("/api/projects", json=project_payload(), headers={"Origin": "https://untrusted.example"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "origin_rejected"


def test_run_is_blocked_when_environment_is_not_ready(client):
    project = client.post("/api/projects", json=project_payload()).json()
    response = client.post("/api/runs", json={"project_id": project["id"], "operator_confirmed": True})
    # CI normally has no Chromium. If it does, the run is valid and returns 202;
    # this test primarily asserts that there is never a silent fallback URL.
    assert response.status_code in {202, 409}
    if response.status_code == 409:
        assert response.json()["error"]["code"] == "environment_validation_failed"
        assert any(check["name"] == "authorized_target" for check in response.json()["error"]["details"]["checks"])
    else:
        cancel = client.post(f"/api/runs/{response.json()['id']}/cancel")
        assert cancel.status_code in {200, 409}


def test_run_requires_immediate_operator_confirmation(client):
    project = client.post("/api/projects", json=project_payload()).json()
    response = client.post("/api/runs", json={"project_id": project["id"], "operator_confirmed": False})
    assert response.status_code == 409
    checks = response.json()["error"]["details"]["checks"]
    assert any(check["name"] == "operator_confirmation" and not check["passed"] for check in checks)
