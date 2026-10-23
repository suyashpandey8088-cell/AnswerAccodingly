import { app } from "electron";
import { ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import type { BackendConnection, BackendState, BackendStatus } from "../preload/types";

export class BackendManager {
  private child: ChildProcess | null = null;
  private token = randomBytes(32).toString("base64url");
  private port: number | null = null;
  private state: BackendState = "stopped";
  private detail = "Backend has not started";
  private logs: string[] = [];
  private stopping = false;
  private readyPromise: Promise<BackendConnection> | null = null;

  async start(): Promise<BackendConnection> {
    if (this.readyPromise && this.state === "ready") return this.readyPromise;
    this.readyPromise = this.startInternal();
    return this.readyPromise;
  }

  private async startInternal(): Promise<BackendConnection> {
    this.stopping = false;
    this.setState("starting", "Starting local Python backend");
    this.port = await this.selectPort();
    const launch = this.launchConfiguration();
    if (launch.command.includes(path.sep) && !existsSync(launch.command)) {
      const message = `Backend runtime was not found: ${launch.command}`;
      this.setState("error", message);
      throw new Error(message);
    }
    const databasePath = path.join(app.getPath("userData"), "quizpilot.db").replace(/\\/g, "/");
    const repositoryDir = app.isPackaged
      ? process.resourcesPath
      : path.resolve(__dirname, "../../../..");
    this.child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: {
        ...process.env,
        QUIZPILOT_API_TOKEN: this.token,
        QUIZPILOT_HOST: "127.0.0.1",
        QUIZPILOT_PORT: String(this.port),
        QUIZPILOT_DATABASE_URL: `sqlite:///${databasePath}`,
        QUIZPILOT_REPOSITORY_DIR: repositoryDir,
        QUIZPILOT_CORS_ORIGINS: "http://localhost:5173,http://127.0.0.1:5173,null",
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.stdout?.on("data", (chunk) => this.appendLog(chunk));
    this.child.stderr?.on("data", (chunk) => this.appendLog(chunk));
    this.child.on("error", (error) => {
      this.appendLog(error.message);
      this.setState("error", `Unable to launch backend: ${error.message}`);
    });
    this.child.on("exit", (code) => {
      if (!this.stopping && this.state !== "error") {
        this.setState("error", `Backend exited unexpectedly (code ${code ?? "unknown"})`);
      }
    });

    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      if (this.state === "error") break;
      if (await this.isHealthy()) {
        this.setState("ready", "Backend healthy");
        return { baseUrl: `http://127.0.0.1:${this.port}`, token: this.token, state: "ready" };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const message = this.detail || `Backend did not become healthy. ${this.logs.join(" ")}`;
    await this.stop();
    this.setState("error", message);
    throw new Error(message);
  }

  private launchConfiguration(): { command: string; args: string[]; cwd: string } {
    if (app.isPackaged) {
      const executable = process.platform === "win32" ? "quizpilot-backend.exe" : "quizpilot-backend";
      const backendDir = path.join(process.resourcesPath, "backend");
      return { command: path.join(backendDir, executable), args: [], cwd: backendDir };
    }
    const backendDir = path.resolve(__dirname, "../../../backend");
    const configuredPython = process.env.QUIZPILOT_PYTHON;
    const command = configuredPython || (process.platform === "win32" ? "python" : "python3");
    return {
      command,
      args: ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(this.port)],
      cwd: backendDir,
    };
  }

  async getConnection(): Promise<BackendConnection> {
    if (!this.readyPromise) return this.start();
    return this.readyPromise;
  }

  async restart(): Promise<BackendConnection> {
    await this.stop();
    this.token = randomBytes(32).toString("base64url");
    this.readyPromise = null;
    return this.start();
  }

  getStatus(): BackendStatus {
    return { state: this.state, detail: this.detail, port: this.port };
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child || child.killed) {
      this.child = null;
      this.setState("stopped", "Backend stopped");
      return;
    }
    this.stopping = true;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGTERM");
    await Promise.race([
      exited,
      new Promise<void>((resolve) => setTimeout(resolve, 4_000)),
    ]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    this.child = null;
    this.readyPromise = null;
    this.setState("stopped", "Backend stopped");
  }

  private async isHealthy(): Promise<boolean> {
    if (!this.port) return false;
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}/health`, {
        signal: AbortSignal.timeout(1_000),
        headers: { Accept: "application/json" },
      });
      return response.ok && (await response.json()).status === "ok";
    } catch {
      return false;
    }
  }

  private async selectPort(): Promise<number> {
    const configured = Number(process.env.QUIZPILOT_PORT || 8765);
    if (Number.isInteger(configured) && configured > 0 && configured < 65536 && await this.portAvailable(configured)) {
      return configured;
    }
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : null;
        server.close(() => port ? resolve(port) : reject(new Error("Unable to allocate a loopback port")));
      });
    });
  }

  private async portAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
  }

  private appendLog(chunk: unknown): void {
    const text = String(chunk).replace(/(token|api[_-]?key)\s*[=:]\s*\S+/gi, "$1=[redacted]").trim();
    if (text) this.logs.push(text.slice(-2_000));
    if (this.logs.length > 12) this.logs.shift();
  }

  private setState(state: BackendState, detail: string): void {
    this.state = state;
    this.detail = detail;
  }
}
