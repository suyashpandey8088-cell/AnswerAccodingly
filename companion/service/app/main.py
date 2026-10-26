import os
import re
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from .models import (
    AnalyzeQuestionRequest,
    AnalyzeQuestionResponse,
    PlaywrightPracticeRequest,
)
from .playwright_runner import run_playwright_practice_inspection

MAX_REQUEST_BYTES = 64 * 1024  # 64 KB hard payload limit (Section 8)
COMPANION_TOKEN = os.environ.get("QUIZPILOT_COMPANION_TOKEN", "local-dev-session-token")

ALLOWED_ORIGIN_PATTERNS = [
    re.compile(r"^chrome-extension://[a-z]{32}$"),
    re.compile(r"^moz-extension://[a-zA-Z0-9-]+$"),
    re.compile(r"^https?://localhost(:\d+)?$"),
    re.compile(r"^https?://127\.0\.0\.1(:\d+)?$"),
]

app = FastAPI(
    title="QuizPilot AI Local Companion Service",
    version="1.0.0",
    description="Optional local FastAPI + Playwright service for authorized practice quiz environments.",
)


def is_origin_permitted(origin: str | None) -> bool:
    if not origin:
        return True  # Same-origin or direct local CLI/test client without Origin header
    return any(pattern.match(origin) for pattern in ALLOWED_ORIGIN_PATTERNS)


@app.middleware("http")
async def security_guard_middleware(request: Request, call_next):
    # 1. Defend against unauthorized websites calling the local companion service (Section 8)
    origin = request.headers.get("origin")
    if not is_origin_permitted(origin):
        return JSONResponse(
            status_code=403,
            content={"detail": f"Unauthorized Origin ({origin}) blocked by companion security policy."},
        )

    # 2. Enforce request-size limit (Section 8)
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_REQUEST_BYTES:
        return JSONResponse(
            status_code=413,
            content={"detail": f"Request body exceeds maximum permitted size ({MAX_REQUEST_BYTES} bytes)."},
        )

    body = await request.body()
    if len(body) > MAX_REQUEST_BYTES:
        return JSONResponse(
            status_code=413,
            content={"detail": f"Request body exceeds maximum permitted size ({MAX_REQUEST_BYTES} bytes)."},
        )

    return await call_next(request)


def verify_companion_token(x_quizpilot_token: str | None) -> None:
    if not x_quizpilot_token or x_quizpilot_token != COMPANION_TOKEN:
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid X-QuizPilot-Token header.",
        )


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "service": "quizpilot-companion",
        "version": "1.0.0",
        "standaloneExtensionSupported": True,
    }


@app.post("/analyze-question", response_model=AnalyzeQuestionResponse)
async def analyze_question(
    payload: AnalyzeQuestionRequest,
    x_quizpilot_token: str | None = Header(default=None),
):
    verify_companion_token(x_quizpilot_token)
    text_lower = payload.questionText.lower()

    if "cap theorem" in text_lower:
        matched = [o.id for o in payload.options if "consistency" in o.text.lower()]
        return AnalyzeQuestionResponse(
            questionId=payload.questionId,
            subject="Distributed Systems",
            topic="Consensus & Replication",
            subtopic="CAP Theorem & Partition Tolerance",
            difficulty="medium",
            proposedAnswers=matched[:1],
            confidenceScore=0.85 if matched else 0.35,
            isUncertain=not bool(matched),
            explanation="Under a network partition, a distributed store must trade off between linearizable Consistency and Availability.",
            sourceProvenance="Local Companion Deterministic Analyzer",
        )

    return AnalyzeQuestionResponse(
        questionId=payload.questionId,
        subject="Computer Science",
        topic="General Systems",
        subtopic="Analytical Reasoning",
        difficulty="medium",
        proposedAnswers=[],
        confidenceScore=0.30,
        isUncertain=True,
        explanation="Insufficient local reference evidence; flagged as uncertain to prevent unverified guessing.",
        sourceProvenance="Local Companion Deterministic Analyzer (Uncertain)",
    )


@app.post("/automate-practice")
async def automate_practice(
    payload: PlaywrightPracticeRequest,
    x_quizpilot_token: str | None = Header(default=None),
):
    verify_companion_token(x_quizpilot_token)
    result = await run_playwright_practice_inspection(
        target_url=payload.targetUrl,
        max_questions=payload.maxQuestions,
        timeout_seconds=payload.timeoutSeconds,
    )
    return result
