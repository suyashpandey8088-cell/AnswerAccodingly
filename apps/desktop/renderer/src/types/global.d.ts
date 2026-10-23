import type { QuizPilotBridge } from "./index";

declare global {
  interface Window {
    quizPilot?: QuizPilotBridge;
  }
}

export {};
