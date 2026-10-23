import { describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: electronMocks.exposeInMainWorld },
  ipcRenderer: { invoke: electronMocks.invoke },
}));

describe("restricted preload bridge", () => {
  it("exposes only typed application operations", async () => {
    await import("./preload");
    const [name, bridge] = electronMocks.exposeInMainWorld.mock.calls[0]!;
    expect(name).toBe("quizPilot");
    expect(Object.keys(bridge).sort()).toEqual([
      "getAppInfo",
      "getBackendConnection",
      "getBackendStatus",
      "restartBackend",
    ]);
    expect(bridge.ipcRenderer).toBeUndefined();
    expect(bridge.require).toBeUndefined();

    electronMocks.invoke.mockResolvedValue({ state: "ready" });
    await bridge.getBackendStatus();
    await bridge.getAppInfo();
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(1, "backend:get-status");
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(2, "app:get-info");
  });
});
