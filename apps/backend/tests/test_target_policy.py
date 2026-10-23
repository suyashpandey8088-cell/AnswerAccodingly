import socket

import pytest

from app.config import Settings
from app.services.target_policy import TargetPolicy, TargetPolicyError


@pytest.mark.asyncio
async def test_loopback_target_and_protocol_policy(settings):
    policy = TargetPolicy(settings)
    target = await policy.validate_url("http://127.0.0.1:8765/demo/")
    assert target.hostname == "127.0.0.1"
    with pytest.raises(TargetPolicyError, match="allowlist"):
        await policy.validate_url("https://example.com/quiz")
    with pytest.raises(TargetPolicyError, match="Only http"):
        await policy.validate_url("file:///tmp/quiz.html")
    with pytest.raises(TargetPolicyError, match="Credentials"):
        await policy.validate_url("http://user:password@127.0.0.1/quiz")


@pytest.mark.asyncio
async def test_dns_rebinding_to_internal_address_is_rejected(monkeypatch):
    settings = Settings(
        target_allowlist="authorized.test",
        allow_non_local_targets=True,
        api_token="test",
    )
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("169.254.169.254", 80))],
    )
    with pytest.raises(TargetPolicyError, match="public global"):
        await TargetPolicy(settings).validate_url("http://authorized.test/latest/meta-data")


@pytest.mark.asyncio
async def test_default_policy_rejects_private_dns_result(monkeypatch):
    settings = Settings(target_allowlist="authorized.test", api_token="test")
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.8", 80))],
    )
    with pytest.raises(TargetPolicyError, match="loopback"):
        await TargetPolicy(settings).validate_url("http://authorized.test/")
