import { describe, expect, it, vi } from "vitest";
import type { BackendConnection } from "../preload/types";
import { BackendManager } from "./backend-manager";

vi.mock("electron", () => ({ app: {} }));

describe("backend lifecycle", () => {
  it("shares one launch attempt between main and renderer callers", async () => {
    const manager = new BackendManager();
    let resolveLaunch!: (connection: BackendConnection) => void;
    const launch = new Promise<BackendConnection>((resolve) => { resolveLaunch = resolve; });
    const startInternal = vi.spyOn(manager as unknown as { startInternal: () => Promise<BackendConnection> }, "startInternal").mockReturnValue(launch);

    const mainCaller = manager.start();
    const rendererCaller = manager.start();
    expect(startInternal).toHaveBeenCalledTimes(1);

    const connection: BackendConnection = { baseUrl: "http://127.0.0.1:8765", token: "test", state: "ready" };
    resolveLaunch(connection);
    await expect(mainCaller).resolves.toEqual(connection);
    await expect(rendererCaller).resolves.toEqual(connection);
  });
});
