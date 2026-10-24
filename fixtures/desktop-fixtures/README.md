# Desktop fixture status

No universal native window-control fixture is claimed. Live Windows Desktop Autopilot requires an operator-owned or explicitly authorized visible application. Open **Desktop Autopilot**, select the uniquely titled visible window, confirm authorization, and choose **Start live Autopilot**. Live mode has no calibration form and does not use measured screen regions.

Windows UI Automation is the primary reader, with OCR fallback inside the same window. UIA-accessible question text, radio/checkbox/list/button options, a single text/code editor, and enabled Submit/Next controls are supported. OCR fallback requires readable options prefixed `A`–`F` or `1`–`6`. Unsupported custom-drawn interfaces, ambiguous controls, duplicate answer labels, and missing question/action controls stop the run rather than triggering coordinate guesses.

On Windows, the adapter requires one unique title match and revalidates the live question, intended control, foreground focus, and current window bounds before input. It does not fall back to another app or bypass OS protections, proctoring, monitoring, or assessment rules.

Headless tests mock live UIA/OCR analysis, legacy OCR/focus/bounds behavior, answer mapping, automatic transitions, delayed feedback, and autonomous stop conditions. A real graphical smoke test still requires Windows, a graphical session, any needed Tesseract/OS permission, and an operator-provided compatible application; native behavior is not automatically marked as passing. Applications without answer feedback can advance, but independent correctness remains `unknown` without an oracle.
