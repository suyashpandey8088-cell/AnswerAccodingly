import { describe, expect, it } from "vitest";
import { validateIpcArguments } from "./ipc-validation";

describe("IPC argument validation", () => {
  it("accepts the fixed argument-free bridge methods", () => {
    expect(validateIpcArguments([])).toEqual([]);
  });

  it("rejects unexpected values and arbitrary channels' payloads", () => {
    expect(() => validateIpcArguments(["shell command"])).toThrow();
    expect(() => validateIpcArguments([{ path: "/etc/passwd" }])).toThrow();
    expect(() => validateIpcArguments([null])).toThrow();
  });
});
