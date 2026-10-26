from typing import List, Literal, Optional
from pydantic import BaseModel, Field


class OptionItem(BaseModel):
    id: str = Field(..., min_length=1, max_length=120)
    label: str = Field(..., min_length=1, max_length=16)
    text: str = Field(..., min_length=1, max_length=600)


class AnalyzeQuestionRequest(BaseModel):
    questionId: str = Field(..., min_length=1, max_length=80)
    questionText: str = Field(..., min_length=1, max_length=2000)
    questionType: Literal[
        "single_choice",
        "multiple_choice",
        "true_false",
        "text_input",
        "unsupported",
    ]
    options: List[OptionItem] = Field(default_factory=list, max_length=20)


class AnalyzeQuestionResponse(BaseModel):
    questionId: str
    subject: str
    topic: str
    subtopic: str
    difficulty: Literal["easy", "medium", "hard"]
    proposedAnswers: List[str]
    confidenceScore: float
    isUncertain: bool
    explanation: str
    sourceProvenance: str


class PlaywrightPracticeRequest(BaseModel):
    targetUrl: str = Field(..., min_length=8, max_length=512)
    maxQuestions: int = Field(default=20, ge=1, le=100)
    timeoutSeconds: int = Field(default=15, ge=2, le=60)
