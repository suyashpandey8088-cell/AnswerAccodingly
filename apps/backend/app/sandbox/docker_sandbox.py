from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
import uuid
from pathlib import Path

from .base import SandboxExecutor, SandboxResult, TestCase


_RUNNER = r'''
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("candidate", "/work/candidate.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
cases = json.load(open("/work/tests.json", encoding="utf-8"))
function = getattr(module, sys.argv[1])
results = []
for case in cases:
    try:
        actual = function(*case.get("args", []), **case.get("kwargs", {}))
        passed = actual == case.get("expected")
        results.append({"passed": passed, "actual": repr(actual), "expected": repr(case.get("expected"))})
    except Exception as exc:
        results.append({"passed": False, "error": type(exc).__name__ + ": " + str(exc)})
print(json.dumps(results))
'''


class DockerSandbox(SandboxExecutor):
    """Opt-in container isolation; generated code never runs in the API process.

    A subprocess timeout alone is not treated as a security boundary. Execution
    is unsupported unless explicitly enabled and Docker plus the pinned local
    runtime image are available.
    """

    def __init__(self, *, enabled: bool = False, image: str = "python:3.12-alpine", timeout_seconds: float = 5) -> None:
        self.enabled = enabled
        self.image = image
        self.timeout_seconds = timeout_seconds

    async def availability(self) -> tuple[bool, str]:
        if not self.enabled:
            return False, "Disabled: set QUIZPILOT_SANDBOX_ENABLED=true after installing Docker and the runtime image"
        if not shutil.which("docker"):
            return False, "Docker CLI is unavailable; generated-code execution remains disabled"
        try:
            process = await asyncio.create_subprocess_exec(
                "docker", "image", "inspect", self.image,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            return_code = await asyncio.wait_for(process.wait(), timeout=3)
            if return_code != 0:
                return False, f"Sandbox image {self.image!r} is not available locally; no image is pulled automatically"
            return True, "Docker container isolation is available"
        except (OSError, asyncio.TimeoutError) as exc:
            return False, f"Docker availability check failed: {type(exc).__name__}"

    async def execute(
        self,
        *,
        code: str,
        language: str,
        function_name: str,
        test_cases: list[TestCase],
    ) -> SandboxResult:
        available, reason = await self.availability()
        if not available:
            return SandboxResult(status="unsupported", details=reason, total_tests=len(test_cases))
        if language.lower() != "python":
            return SandboxResult(status="unsupported", details="Only the Python Docker runner is implemented", total_tests=len(test_cases))
        if not function_name.isidentifier():
            return SandboxResult(status="error", details="Invalid function name", total_tests=len(test_cases))

        with tempfile.TemporaryDirectory(prefix="quizpilot-sandbox-") as directory:
            container_name = f"quizpilot-{uuid.uuid4().hex}"
            work = Path(directory)
            (work / "candidate.py").write_text(code, encoding="utf-8")
            (work / "run_tests.py").write_text(_RUNNER, encoding="utf-8")
            (work / "tests.json").write_text(json.dumps([case.model_dump() for case in test_cases]), encoding="utf-8")
            command = [
                "docker", "run", "--rm", "--name", container_name, "--network", "none",
                "--memory", "128m", "--memory-swap", "128m", "--cpus", "0.5",
                "--pids-limit", "64", "--read-only", "--cap-drop", "ALL",
                "--security-opt", "no-new-privileges", "--user", "65532:65532",
                "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
                "--mount", f"type=bind,src={work},dst=/work,readonly",
                "--workdir", "/tmp", self.image,
                "python", "/work/run_tests.py", function_name,
            ]
            try:
                process = await asyncio.create_subprocess_exec(
                    *command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
                )
                try:
                    stdout_bytes, stderr_bytes = await asyncio.wait_for(process.communicate(), timeout=self.timeout_seconds)
                except asyncio.TimeoutError:
                    process.kill()
                    await process.communicate()
                    # Killing the Docker CLI is not a container security boundary.
                    # Explicitly stop the uniquely named container as well.
                    cleanup = await asyncio.create_subprocess_exec(
                        "docker", "kill", container_name,
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL,
                    )
                    await asyncio.wait_for(cleanup.wait(), timeout=3)
                    return SandboxResult(status="timeout", total_tests=len(test_cases), details="Wall-clock sandbox deadline exceeded")
                stdout = stdout_bytes.decode("utf-8", errors="replace")[-16_000:]
                stderr = stderr_bytes.decode("utf-8", errors="replace")[-16_000:]
                if process.returncode != 0:
                    return SandboxResult(status="error", total_tests=len(test_cases), stdout=stdout, stderr=stderr, details="Sandbox runtime or compilation failed")
                results = json.loads(stdout.strip().splitlines()[-1])
                passed = sum(1 for item in results if item.get("passed"))
                return SandboxResult(
                    status="passed" if passed == len(results) else "failed",
                    passed_tests=passed,
                    total_tests=len(results),
                    stdout=json.dumps(results),
                    stderr=stderr,
                )
            except (OSError, json.JSONDecodeError, IndexError) as exc:
                return SandboxResult(status="error", total_tests=len(test_cases), details=f"Sandbox execution error: {type(exc).__name__}")
