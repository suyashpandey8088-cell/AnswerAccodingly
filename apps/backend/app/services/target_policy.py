from __future__ import annotations

import asyncio
import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

from ..config import Settings


class TargetPolicyError(ValueError):
    pass


@dataclass(frozen=True)
class ValidatedTarget:
    url: str
    hostname: str
    addresses: tuple[str, ...]


class TargetPolicy:
    """Allowlist + DNS/IP policy for every initial and redirected target."""

    def __init__(self, settings: Settings) -> None:
        self.allowed_hosts = settings.allowed_targets
        self.allow_non_local = settings.allow_non_local_targets

    async def validate_url(self, url: str) -> ValidatedTarget:
        try:
            parsed = urlsplit(url)
            # Accessing port validates malformed/out-of-range values.
            _ = parsed.port
        except ValueError as exc:
            raise TargetPolicyError("Target URL is malformed") from exc
        if parsed.scheme not in {"http", "https"}:
            raise TargetPolicyError("Only http and https target URLs are supported")
        if parsed.username or parsed.password:
            raise TargetPolicyError("Credentials embedded in target URLs are not allowed")
        hostname = (parsed.hostname or "").rstrip(".").lower()
        if not hostname:
            raise TargetPolicyError("Target URL requires a hostname")
        if hostname not in self.allowed_hosts:
            raise TargetPolicyError(f"Target host {hostname!r} is not in the explicit allowlist")
        try:
            records = await asyncio.to_thread(
                socket.getaddrinfo, hostname, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM
            )
        except socket.gaierror as exc:
            raise TargetPolicyError("Target hostname could not be resolved") from exc
        addresses = tuple(sorted({record[4][0] for record in records}))
        if not addresses:
            raise TargetPolicyError("Target hostname did not resolve to an address")
        for address in addresses:
            ip = ipaddress.ip_address(address.split("%", 1)[0])
            if self.allow_non_local:
                if not ip.is_global:
                    raise TargetPolicyError("Non-local targets must resolve to public global addresses; internal and metadata addresses are blocked")
            elif not ip.is_loopback:
                raise TargetPolicyError("This installation allows loopback test targets only")
        normalized = urlunsplit((parsed.scheme, parsed.netloc, parsed.path or "/", parsed.query, ""))
        return ValidatedTarget(url=normalized, hostname=hostname, addresses=addresses)
