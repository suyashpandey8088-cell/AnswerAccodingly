# Desktop fixture status

No universal native window-control fixture is claimed for the MVP. The desktop adapter requires an operator-owned visible application and explicitly measured regions for `question`, `answer`, and `submit`; `timer`, `feedback`, `next`, and option regions are optional capabilities.

Use the project's **Desktop · Calibrated OCR** editor to enter regions. Keep the window in a fixed position during the run. Never reuse coordinates across resolutions, displays, or window positions without recalibration.

Headless CI tests mock OCR output. A real graphical smoke test requires a graphical session, Tesseract, OS accessibility/screen-recording permission, and an operator-provided application fixture; it is not automatically marked as passing.
