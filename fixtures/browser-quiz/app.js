"use strict";

const questions = [
  {
    id: "demo-http-404",
    type: "multiple_choice",
    kind: "Multiple choice",
    text: "Which HTTP status code means Not Found?",
    hint: "Select one response.",
    options: ["200", "201", "404", "500"],
    expected: ["404"],
  },
  {
    id: "demo-primes",
    type: "multiple_select",
    kind: "Multiple select",
    text: "Select all prime numbers.",
    hint: "More than one response may be correct.",
    options: ["1", "2", "3", "4", "5"],
    expected: ["2", "3", "5"],
  },
  {
    id: "demo-arithmetic",
    type: "math",
    kind: "Mathematics",
    text: "Calculate 12 × 3 - 6.",
    hint: "Enter a numeric answer. This response has a deliberately delayed UI.",
    expectedText: "30",
    delay: 900,
  },
  {
    id: "demo-sequence",
    type: "logical",
    kind: "Logical reasoning",
    text: "What comes next in the sequence 2, 4, 8, 16?",
    hint: "Select the next value.",
    options: ["18", "24", "32", "64"],
    expected: ["32"],
  },
  {
    id: "demo-capital",
    type: "text",
    kind: "Text answer",
    text: "What is the capital of France?",
    hint: "Enter a short text answer.",
    expectedText: "Paris",
  },
  {
    id: "demo-add-function",
    type: "programming",
    kind: "Programming",
    text: "Write a Python function named add(a, b) that returns their sum.",
    hint: "Code correctness is established only by QuizPilot's isolated test runner, not by this feedback message.",
    programming: true,
  },
];

const params = new URLSearchParams(window.location.search);
const scenario = params.get("scenario") || "normal";
const scenarioControl = document.getElementById("scenario");
scenarioControl.value = scenario;
scenarioControl.addEventListener("change", () => {
  const next = new URL(window.location.href);
  next.searchParams.set("scenario", scenarioControl.value);
  window.location.assign(next);
});

const root = document.getElementById("question-screen");
const options = document.getElementById("options");
const questionText = document.getElementById("question");
const questionHint = document.getElementById("question-hint");
const textWrap = document.getElementById("text-answer-wrap");
const textAnswer = document.getElementById("text-answer");
const codeWrap = document.getElementById("code-answer-wrap");
const codeAnswer = document.getElementById("code-answer");
const feedback = document.getElementById("feedback");
const submit = document.getElementById("submit");
const next = document.getElementById("next");
const complete = document.getElementById("quiz-complete");
const timerText = document.getElementById("timer-text");
let index = 0;
let remaining = 90;
let timerHandle = null;
let submitted = false;

function formatTimer(value) {
  const minutes = Math.floor(value / 60).toString().padStart(2, "0");
  const seconds = (value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function startTimer() {
  window.clearInterval(timerHandle);
  remaining = 90;
  timerText.textContent = formatTimer(remaining);
  timerHandle = window.setInterval(() => {
    if (remaining > 0) {
      remaining -= 1;
      timerText.textContent = formatTimer(remaining);
    }
  }, 1000);
}

function renderQuestion() {
  const item = questions[index];
  submitted = false;
  root.hidden = false;
  complete.hidden = true;
  root.dataset.questionId = item.id;
  root.dataset.questionType = item.type;
  root.dataset.submitted = "false";
  document.getElementById("question-number").textContent = `Question ${index + 1} of ${questions.length}`;
  document.getElementById("question-kind").textContent = item.kind;
  document.getElementById("progress-bar").style.width = `${(index / questions.length) * 100}%`;
  questionText.textContent = item.text;
  questionHint.textContent = item.hint;
  options.replaceChildren();
  options.hidden = !item.options;
  if (item.options && !(scenario === "missing_element" && item.id === "demo-primes")) {
    item.options.forEach((value, optionIndex) => {
      const label = document.createElement("label");
      label.className = "option";
      label.dataset.qa = "option";
      label.dataset.value = value;
      label.dataset.optionId = `${item.id}-option-${optionIndex + 1}`;
      const input = document.createElement("input");
      input.type = item.type === "multiple_select" ? "checkbox" : "radio";
      input.name = `answer-${item.id}`;
      input.value = value;
      const caption = document.createElement("span");
      caption.textContent = value;
      label.append(input, caption);
      options.append(label);
    });
  }
  const usesText = !item.options && !item.programming;
  textWrap.hidden = !usesText;
  textAnswer.value = "";
  textAnswer.required = usesText;
  codeWrap.hidden = !item.programming;
  codeAnswer.value = "";
  codeAnswer.required = Boolean(item.programming);
  feedback.hidden = true;
  feedback.textContent = "";
  feedback.dataset.outcome = "unknown";
  submit.disabled = false;
  next.disabled = true;
  next.textContent = index === questions.length - 1 ? "Finish fixture →" : "Next question →";
  startTimer();
}

function selectedValues() {
  return Array.from(options.querySelectorAll("input:checked"), (input) => input.value).sort();
}

function isCorrect(item) {
  if (item.programming) return null;
  if (item.options) {
    const actual = selectedValues();
    const expected = [...item.expected].sort();
    return actual.length === expected.length && actual.every((value, position) => value === expected[position]);
  }
  return textAnswer.value.trim().toLocaleLowerCase() === item.expectedText.toLocaleLowerCase();
}

document.getElementById("answer-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (submitted) return;
  const item = questions[index];
  if (item.options && selectedValues().length === 0) {
    feedback.hidden = false;
    feedback.dataset.outcome = "unknown";
    feedback.textContent = "Select at least one option before submitting.";
    return;
  }
  if (!event.target.reportValidity()) return;
  submitted = true;
  root.dataset.submitted = "true";
  submit.disabled = true;
  feedback.hidden = true;

  if (scenario === "timeout") return;
  const baseDelay = item.delay || 180;
  const delay = scenario === "delayed" ? 2400 : baseDelay;
  window.setTimeout(() => {
    let correct = isCorrect(item);
    if (scenario === "incorrect_feedback" && correct !== null) correct = !correct;
    feedback.hidden = false;
    if (correct === null) {
      feedback.dataset.outcome = "unknown";
      feedback.textContent = "Code submission recorded. Correctness requires independent sandbox test results.";
    } else {
      feedback.dataset.outcome = correct ? "correct" : "incorrect";
      feedback.textContent = correct ? "Correct — feedback control transitioned as expected." : "Incorrect — the fixture recorded an incorrect response.";
    }
    next.disabled = false;
    next.focus();
  }, delay);
});

next.addEventListener("click", () => {
  if (!submitted || next.disabled) return;
  if (index === questions.length - 1) {
    window.clearInterval(timerHandle);
    root.hidden = true;
    complete.hidden = false;
    document.getElementById("progress-bar").style.width = "100%";
    return;
  }
  index += 1;
  renderQuestion();
  questionText.focus();
});

document.getElementById("restart").addEventListener("click", () => {
  index = 0;
  renderQuestion();
});

renderQuestion();
