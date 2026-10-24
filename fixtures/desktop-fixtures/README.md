# Desktop fixture status

No universal native window-control fixture is claimed. Windows Desktop Autopilot requires an operator-owned or explicitly authorized visible application and measured regions for `question`, `answer`, and `submit`; `timer`, `feedback`, `next`, `complete`, and `option_1`…`option_6` are optional capabilities. Use `next` for multi-question navigation and calibrate `complete` to recognize a results/completion screen.

Use **Desktop Autopilot → New Autopilot** for a desktop-only template, or the advanced project editor. Keep the window in a fixed position during the run. Never reuse coordinates across resolutions, displays, DPI settings, or window positions without recalibration.

On Windows, the adapter requires one unique title match, verifies foreground focus, and refuses calibrated regions outside the current window. It does not fall back to another app or bypass OS protections.

Headless tests mock OCR, focus, bounds, answer mapping, delayed feedback, and autonomous stop conditions. A real graphical smoke test still requires Windows, a graphical session, Tesseract, OS permission, and an operator-provided application fixture; it is not automatically marked as passing.
