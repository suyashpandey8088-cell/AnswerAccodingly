import asyncio

import pytest

from app.sandbox.base import TestCase as SandboxTestCase
from app.sandbox.docker_sandbox import DockerSandbox


@pytest.mark.asyncio
async def test_sandbox_disabled_is_explicitly_unsupported():
    result = await DockerSandbox(enabled=False).execute(
        code="def add(a,b): return a+b",
        language="python",
        function_name="add",
        test_cases=[SandboxTestCase(args=[1, 2], expected=3)],
    )
    assert result.status == "unsupported"
    assert result.passed_tests == 0


@pytest.mark.asyncio
async def test_container_command_has_isolation_controls(monkeypatch):
    commands = []

    class FakeProcess:
        returncode = 0

        async def communicate(self):
            return b'[{"passed": true, "actual": "3", "expected": "3"}]\n', b""

    async def fake_exec(*command, **kwargs):
        commands.append(command)
        return FakeProcess()

    async def available():
        return True, "mocked container available"

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    sandbox = DockerSandbox(enabled=True)
    sandbox.availability = available
    result = await sandbox.execute(
        code="def add(a,b): return a+b",
        language="python",
        function_name="add",
        test_cases=[SandboxTestCase(args=[1, 2], expected=3)],
    )
    assert result.status == "passed"
    command = commands[0]
    assert "--network" in command and "none" in command
    assert "--read-only" in command
    assert "--cap-drop" in command and "ALL" in command
    assert "--memory" in command and "128m" in command
    assert not any("QUIZPILOT_LLM" in part for part in command)


@pytest.mark.asyncio
async def test_sandbox_timeout_kills_named_container(monkeypatch):
    commands = []

    class HangingProcess:
        def __init__(self):
            self.killed = False

        def kill(self):
            self.killed = True

        async def communicate(self):
            if self.killed:
                return b"", b""
            await asyncio.sleep(10)

    class CleanupProcess:
        async def wait(self):
            return 0

    hanging = HangingProcess()

    async def fake_exec(*command, **kwargs):
        commands.append(command)
        return CleanupProcess() if command[1] == "kill" else hanging

    async def available():
        return True, "mocked container available"

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    sandbox = DockerSandbox(enabled=True, timeout_seconds=0.01)
    sandbox.availability = available
    result = await sandbox.execute(
        code="while True: pass",
        language="python",
        function_name="add",
        test_cases=[SandboxTestCase(args=[1, 2], expected=3)],
    )
    assert result.status == "timeout"
    assert hanging.killed
    assert any(command[1] == "kill" for command in commands)


@pytest.mark.sandbox
@pytest.mark.asyncio
async def test_real_docker_sandbox(sandbox_enabled):
    sandbox = DockerSandbox(enabled=True)
    result = await sandbox.execute(
        code="def add(a, b):\n    return a + b\n",
        language="python",
        function_name="add",
        test_cases=[SandboxTestCase(args=[2, 3], expected=5)],
    )
    assert result.status == "passed", result.details
