import "server-only";

import {
  PROTOCOL_VERSION,
  client,
  methods,
  ndJsonStream,
  type ActiveSession,
  type ClientConnection,
  type ClientContext,
  type InitializeResponse,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
  type Usage as AcpUsage,
} from "@agentclientprotocol/sdk";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { CursorAgentError, type CursorKeyOrigin } from "./cursor-errors";
import { CURSOR_AGENT_BIN, cursorAgentChildPath } from "./cursor-loop";
import type { CursorModelParameterSelection } from "./cursor-model-params";
import {
  cursorAcpConfigValue,
  findCursorAcpConfigOption,
  findCursorAcpModelOption,
  type CursorAcpAvailableModelsResponse,
} from "./cursor-acp-models";
import {
  createCursorAcpWorkspace,
  type CursorAcpWorkspace,
} from "./cursor-acp-workspace";
import { COACH_MCP_TOOL_NAMES } from "@/coach-mcp/tool-policy";

const CURSOR_ACP_WALL_MS = 120_000;
const CURSOR_ACP_STARTUP_MS = 30_000;
const CURSOR_ACP_REQUEST_MS = 15_000;
const CURSOR_ACP_CANCEL_GRACE_MS = 5_000;
const STDERR_EDGE_CHARS = 2_000;

class BoundedStderr {
  private prefix = "";
  private tail = "";
  private totalChars = 0;

  constructor(private readonly secret: string) {}

  append(chunk: string): void {
    const guardChars = Math.max(16, this.secret.length - 1);
    const retainedChars = STDERR_EDGE_CHARS + guardChars;
    this.totalChars += chunk.length;
    if (this.prefix.length < retainedChars) {
      this.prefix += chunk.slice(0, retainedChars - this.prefix.length);
    }
    this.tail = `${this.tail}${chunk}`.slice(-retainedChars);
  }

  summary(): string {
    const guardChars = Math.max(16, this.secret.length - 1);
    const truncated = this.totalChars > this.prefix.length;
    const prefixRaw = truncated
      ? this.prefix.slice(0, Math.max(0, this.prefix.length - guardChars))
      : this.prefix;
    const tailRaw = truncated ? this.tail.slice(guardChars) : this.tail;
    const redact = (value: string) => {
      const withoutSecret = this.secret
        ? value.replaceAll(this.secret, "[redacted]")
        : value;
      return withoutSecret
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .trim();
    };
    const prefix = redact(prefixRaw);
    const tail = redact(tailRaw);
    if (!prefix) return tail;
    if (!tail || prefix.endsWith(tail)) return prefix;
    return `${prefix}\n…\n${tail}`;
  }
}

export function canonicalCoachToolName(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  for (const tool of COACH_MCP_TOOL_NAMES) {
    const candidate = tool.toLowerCase();
    if (
      [
        candidate,
        `whoop_${candidate}`,
        `whoop:${candidate}`,
        `whoop__${candidate}`,
        `mcp__whoop__${candidate}`,
      ].includes(normalized)
    ) {
      return tool;
    }
  }
  return null;
}

export function cursorAcpPermissionResponse(
  request: RequestPermissionRequest,
): RequestPermissionResponse {
  const allowed =
    (canonicalCoachToolName(request.toolCall.name) ??
      canonicalCoachToolName(request.toolCall.title)) !== null;
  const preferred = allowed
    ? (request.options.find((option) => option.kind === "allow_once") ??
      request.options.find((option) => option.kind === "allow_always"))
    : (request.options.find((option) => option.kind === "reject_once") ??
      request.options.find((option) => option.kind === "reject_always"));
  return preferred
    ? { outcome: { outcome: "selected", optionId: preferred.optionId } }
    : { outcome: { outcome: "cancelled" } };
}

function cursorAcpArgs(): string[] {
  const endpoint = process.env.CURSOR_BACKEND_URL?.trim();
  return [...(endpoint ? ["-e", endpoint] : []), "acp"];
}

function redactDiagnostic(value: string, secret: string): string {
  const redacted = value
    .replaceAll(secret, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  return redacted.length <= 1_000
    ? redacted
    : `${redacted.slice(0, 500)}\n…\n${redacted.slice(-500)}`;
}

function killProcessTree(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process has already exited.
    }
  }
}

async function terminateProcessTree(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  if (
    child.pid === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return;
  }
  const closed = new Promise<boolean>((resolve) =>
    child.once("close", () => resolve(true)),
  );
  killProcessTree(child, "SIGTERM");
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const exited = await Promise.race([
    closed,
    new Promise<false>((resolve) => {
      graceTimer = setTimeout(() => resolve(false), CURSOR_ACP_CANCEL_GRACE_MS);
      graceTimer.unref?.();
    }),
  ]);
  if (graceTimer) clearTimeout(graceTimer);
  if (exited) return;
  killProcessTree(child, "SIGKILL");
  await Promise.race([
    closed,
    new Promise<void>((resolve) => setTimeout(resolve, 250)),
  ]);
}

export type CursorAcpRuntimeDiagnostics = {
  protocolVersion: number | null;
  agentName: string | null;
  agentVersion: string | null;
  sessionId: string | null;
  requestedModel: string | null;
  resolvedModel: string | null;
  appliedParameters: CursorModelParameterSelection[];
  stderr: string;
  process: {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    cancelled: boolean;
    timedOut: boolean;
  };
  timing: {
    spawnMs: number;
    initializeMs: number;
    authenticateMs: number;
    sessionMs: number;
    modelConfigMs: number;
    firstEventMs: number | null;
    promptMs: number | null;
  };
};

export class CursorAcpRuntime {
  readonly diagnostics: CursorAcpRuntimeDiagnostics;
  readonly workspace: CursorAcpWorkspace;
  readonly credentialFingerprint: string;
  readonly promptFingerprint: string;
  hasPrompted = false;
  historyFingerprint: string | null = null;

  private readonly child: ChildProcessWithoutNullStreams;
  private readonly connection: ClientConnection;
  private readonly context: ClientContext;
  private readonly session: ActiveSession;
  private readonly initializeResult: InitializeResponse;
  private readonly stderr: BoundedStderr;
  private readonly requestTimeoutMs: number;
  private disposed = false;
  private disposePromise: Promise<void> | null = null;
  private configOptions: SessionConfigOption[];
  private usageSnapshot: AcpUsage | null = null;
  private activeCancel:
    ((reason: unknown, wasCancellation?: boolean) => void) | null = null;

  private constructor(input: {
    child: ChildProcessWithoutNullStreams;
    connection: ClientConnection;
    context: ClientContext;
    session: ActiveSession;
    initializeResult: InitializeResponse;
    workspace: CursorAcpWorkspace;
    credentialFingerprint: string;
    promptFingerprint: string;
    diagnostics: CursorAcpRuntimeDiagnostics;
    stderr: BoundedStderr;
    requestTimeoutMs: number;
  }) {
    this.child = input.child;
    this.connection = input.connection;
    this.context = input.context;
    this.session = input.session;
    this.initializeResult = input.initializeResult;
    this.workspace = input.workspace;
    this.credentialFingerprint = input.credentialFingerprint;
    this.promptFingerprint = input.promptFingerprint;
    this.diagnostics = input.diagnostics;
    this.stderr = input.stderr;
    this.requestTimeoutMs = input.requestTimeoutMs;
    this.configOptions = [
      ...(input.session.newSessionResponse.configOptions ?? []),
    ];
  }

  static async start(input: {
    userId: number;
    key: string;
    keyOrigin: CursorKeyOrigin;
    credentialFingerprint: string;
    promptFingerprint: string;
    withMcp: boolean;
    agentBin?: string;
    agentArgs?: string[];
    agentEnv?: Record<string, string | undefined>;
    requestTimeoutMs?: number;
  }): Promise<CursorAcpRuntime> {
    const workspace = await createCursorAcpWorkspace(
      input.userId,
      input.withMcp,
    );
    const stderr = new BoundedStderr(input.key);
    const diagnostics: CursorAcpRuntimeDiagnostics = {
      protocolVersion: null,
      agentName: null,
      agentVersion: null,
      sessionId: null,
      requestedModel: null,
      resolvedModel: null,
      appliedParameters: [],
      stderr: "",
      process: {
        exitCode: null,
        signal: null,
        cancelled: false,
        timedOut: false,
      },
      timing: {
        spawnMs: 0,
        initializeMs: 0,
        authenticateMs: 0,
        sessionMs: 0,
        modelConfigMs: 0,
        firstEventMs: null,
        promptMs: null,
      },
    };
    const spawnStarted = Date.now();
    const agentBin = input.agentBin ?? CURSOR_AGENT_BIN;
    const child = spawn(agentBin, input.agentArgs ?? cursorAcpArgs(), {
      cwd: workspace.root,
      env: {
        ...process.env,
        ...input.agentEnv,
        PATH: cursorAgentChildPath(
          agentBin,
          process.env.PATH,
          process.env.COACH_CURSOR_CHILD_PATH,
          workspace.shimBin,
        ),
        CURSOR_API_KEY: input.key,
      },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
    diagnostics.timing.spawnMs = Date.now() - spawnStarted;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr.append(chunk);
      diagnostics.stderr = stderr.summary();
    });
    child.once("close", (code, signal) => {
      diagnostics.process.exitCode = code;
      diagnostics.process.signal = signal;
    });
    const spawnFailure = new Promise<never>((_resolve, reject) => {
      child.once("error", reject);
    });
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    const startupFailure = new Promise<never>((_resolve, reject) => {
      startupTimer = setTimeout(
        () =>
          reject(
            new CursorAgentError("timeout", "Cursor ACP startup timed out"),
          ),
        CURSOR_ACP_STARTUP_MS,
      );
      startupTimer.unref?.();
    });

    const app = client({ name: "whoop-coach" }).onRequest(
      methods.client.session.requestPermission,
      ({ params }) => cursorAcpPermissionResponse(params),
    );
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    const connection = app.connect(stream);
    const context = connection.agent;
    connection.closed
      .then(() => {
        diagnostics.stderr = stderr.summary();
      })
      .catch(() => {});

    try {
      const initializeStarted = Date.now();
      const initializeResult = await Promise.race([
        context.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientInfo: { name: "whoop-coach", version: "1.0.0" },
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
            _meta: { parameterizedModelPicker: true },
          },
        }),
        spawnFailure,
        startupFailure,
      ]);
      diagnostics.timing.initializeMs = Date.now() - initializeStarted;
      diagnostics.protocolVersion = initializeResult.protocolVersion;
      diagnostics.agentName = initializeResult.agentInfo?.name ?? null;
      diagnostics.agentVersion = initializeResult.agentInfo?.version ?? null;

      const authenticateStarted = Date.now();
      await Promise.race([
        context.request(methods.agent.authenticate, {
          methodId: "cursor_login",
        }),
        spawnFailure,
        startupFailure,
      ]);
      diagnostics.timing.authenticateMs = Date.now() - authenticateStarted;

      const sessionStarted = Date.now();
      const session = await Promise.race([
        context
          .buildSession({
            cwd: workspace.root,
            mcpServers: workspace.mcpServer ? [workspace.mcpServer] : [],
          })
          .start(),
        spawnFailure,
        startupFailure,
      ]);
      diagnostics.timing.sessionMs = Date.now() - sessionStarted;
      diagnostics.sessionId = session.sessionId;

      if (
        session.modes?.currentModeId !== "ask" &&
        session.modes?.availableModes.some((mode) => mode.id === "ask")
      ) {
        await Promise.race([
          context.request(methods.agent.session.setMode, {
            sessionId: session.sessionId,
            modeId: "ask",
          }),
          spawnFailure,
          startupFailure,
        ]);
      }

      if (startupTimer) clearTimeout(startupTimer);
      return new CursorAcpRuntime({
        child,
        connection,
        context,
        session,
        initializeResult,
        workspace,
        credentialFingerprint: input.credentialFingerprint,
        promptFingerprint: input.promptFingerprint,
        diagnostics,
        stderr,
        requestTimeoutMs: input.requestTimeoutMs ?? CURSOR_ACP_REQUEST_MS,
      });
    } catch (error) {
      if (startupTimer) clearTimeout(startupTimer);
      connection.close(error);
      await terminateProcessTree(child);
      await workspace.dispose();
      if (error instanceof CursorAgentError) throw error;
      const auth = /auth|unauthor|forbidden|invalid.*key|401|403/i.test(
        `${error instanceof Error ? error.message : String(error)}\n${stderr.summary()}`,
      );
      throw new CursorAgentError(
        auth ? "auth" : "agent",
        auth
          ? "Cursor API key rejected"
          : redactDiagnostic(
              `Cursor ACP startup failed: ${
                error instanceof Error ? error.message : String(error)
              }${stderr.summary() ? `; ${stderr.summary()}` : ""}`,
              input.key,
            ),
        auth ? input.keyOrigin : undefined,
      );
    }
  }

  isHealthy(): boolean {
    return (
      !this.disposed &&
      !this.connection.signal.aborted &&
      this.child.exitCode === null &&
      this.child.signalCode === null
    );
  }

  private async requestWithTimeout<T>(
    request: Promise<T>,
    message: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        request,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new CursorAgentError("timeout", message)),
            this.requestTimeoutMs,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async listAvailableModels(): Promise<CursorAcpAvailableModelsResponse> {
    return this.requestWithTimeout(
      this.context.request<CursorAcpAvailableModelsResponse>(
        "cursor/list_available_models",
        {},
      ),
      "Cursor ACP model discovery timed out",
    );
  }

  async applyModel(
    model: string,
    parameters: CursorModelParameterSelection[],
  ): Promise<void> {
    const started = Date.now();
    this.diagnostics.requestedModel = model;
    const modelOption = findCursorAcpModelOption(this.configOptions);
    if (!modelOption || modelOption.type !== "select") {
      throw new CursorAgentError(
        "agent",
        "Cursor ACP did not advertise a selectable model configuration",
      );
    }
    if (
      !modelOption.options
        .flatMap((option) => ("group" in option ? option.options : [option]))
        .some((option) => option.value === model)
    ) {
      throw new CursorAgentError(
        "agent",
        `Cursor model is not available in the active ACP runtime: ${model}`,
      );
    }
    try {
      const modelResponse = await this.requestWithTimeout(
        this.context.request(methods.agent.session.setConfigOption, {
          sessionId: this.session.sessionId,
          configId: modelOption.id,
          value: model,
        }),
        "Cursor ACP model configuration timed out",
      );
      this.configOptions = [...modelResponse.configOptions];

      const applied: CursorModelParameterSelection[] = [];
      for (const selection of parameters) {
        const option = findCursorAcpConfigOption(this.configOptions, selection);
        if (!option) {
          throw new CursorAgentError(
            "agent",
            `Cursor model parameter is unavailable: ${selection.id}`,
          );
        }
        const value = cursorAcpConfigValue(option, selection.value);
        if (value === null) {
          throw new CursorAgentError(
            "agent",
            `Cursor model parameter value is unavailable: ${selection.id}=${selection.value}`,
          );
        }
        const response = await this.requestWithTimeout(
          this.context.request(
            methods.agent.session.setConfigOption,
            typeof value === "boolean"
              ? {
                  sessionId: this.session.sessionId,
                  configId: option.id,
                  type: "boolean",
                  value,
                }
              : {
                  sessionId: this.session.sessionId,
                  configId: option.id,
                  value,
                },
          ),
          "Cursor ACP model configuration timed out",
        );
        this.configOptions = [...response.configOptions];
        applied.push({ id: option.id, value: String(value) });
      }
      const resolvedModel = findCursorAcpModelOption(this.configOptions);
      this.diagnostics.resolvedModel =
        resolvedModel?.type === "select" ? resolvedModel.currentValue : model;
      this.diagnostics.appliedParameters = applied;
      this.diagnostics.timing.modelConfigMs = Date.now() - started;
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }

  async cancelActiveTurn(reason: unknown): Promise<void> {
    if (this.activeCancel) {
      this.activeCancel(reason);
      return;
    }
    await this.context
      .notify(methods.agent.session.cancel, {
        sessionId: this.session.sessionId,
      })
      .catch(() => {});
  }

  async prepareTurn(
    images: Parameters<CursorAcpWorkspace["prepareTurn"]>[0],
  ): Promise<void> {
    await this.workspace.prepareTurn(images);
  }

  usageDelta(next: AcpUsage | null | undefined): AcpUsage | null {
    if (!next) return null;
    const previous = this.usageSnapshot;
    this.usageSnapshot = next;
    return {
      totalTokens: Math.max(0, next.totalTokens - (previous?.totalTokens ?? 0)),
      inputTokens: Math.max(0, next.inputTokens - (previous?.inputTokens ?? 0)),
      outputTokens: Math.max(
        0,
        next.outputTokens - (previous?.outputTokens ?? 0),
      ),
      thoughtTokens: Math.max(
        0,
        (next.thoughtTokens ?? 0) - (previous?.thoughtTokens ?? 0),
      ),
      cachedReadTokens: Math.max(
        0,
        (next.cachedReadTokens ?? 0) - (previous?.cachedReadTokens ?? 0),
      ),
      cachedWriteTokens: Math.max(
        0,
        (next.cachedWriteTokens ?? 0) - (previous?.cachedWriteTokens ?? 0),
      ),
    };
  }

  async prompt(
    text: string,
    signal: AbortSignal | undefined,
    onUpdate: (notification: SessionNotification) => void,
  ): Promise<PromptResponse> {
    if (!this.isHealthy()) {
      throw new CursorAgentError("agent", "Cursor ACP session is not healthy");
    }
    signal?.throwIfAborted();
    const promptStarted = Date.now();
    this.diagnostics.timing.firstEventMs = null;
    this.diagnostics.timing.promptMs = null;
    let timedOut = false;
    let forceReject: ((error: unknown) => void) | null = null;
    const forced = new Promise<never>((_resolve, reject) => {
      forceReject = reject;
    });
    let cancelEscalation: ReturnType<typeof setTimeout> | undefined;
    const cancel = (reason: unknown, wasCancellation = true) => {
      if (wasCancellation) {
        this.diagnostics.process.cancelled = true;
        this.diagnostics.process.timedOut = timedOut;
      }
      void this.context
        .notify(methods.agent.session.cancel, {
          sessionId: this.session.sessionId,
        })
        .catch(() => {});
      if (!cancelEscalation) {
        cancelEscalation = setTimeout(() => {
          void this.dispose();
          forceReject?.(reason);
        }, CURSOR_ACP_CANCEL_GRACE_MS);
        cancelEscalation.unref?.();
      }
    };
    this.activeCancel = cancel;
    const onAbort = () =>
      cancel(signal?.reason ?? new Error("Coach turn aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });
    const wallTimer = setTimeout(() => {
      timedOut = true;
      cancel(new CursorAgentError("timeout", "Cursor coach timed out"));
    }, CURSOR_ACP_WALL_MS);
    wallTimer.unref?.();

    try {
      const promptFailure = new Promise<never>((_resolve, reject) => {
        void this.session.prompt(text).catch(reject);
      });
      const consume = async (): Promise<PromptResponse> => {
        for (;;) {
          const message = await this.session.nextUpdate();
          if (message.kind === "stop") return message.response;
          if (this.diagnostics.timing.firstEventMs === null) {
            this.diagnostics.timing.firstEventMs = Date.now() - promptStarted;
          }
          onUpdate(message.notification);
        }
      };
      const response = await Promise.race([consume(), forced, promptFailure]);
      if (timedOut) {
        await this.dispose();
        throw new CursorAgentError("timeout", "Cursor coach timed out");
      }
      signal?.throwIfAborted();
      this.hasPrompted = true;
      this.diagnostics.timing.promptMs = Date.now() - promptStarted;
      return response;
    } catch (error) {
      if (signal?.aborted) {
        await this.dispose();
      } else if (!timedOut) {
        cancel(error, false);
        await this.dispose();
        if (error instanceof CursorAgentError) throw error;
        throw new CursorAgentError(
          "agent",
          `Cursor ACP prompt failed: ${
            error instanceof Error ? error.message : String(error)
          }${this.stderr.summary() ? `; ${this.stderr.summary()}` : ""}`,
        );
      } else {
        await this.dispose();
      }
      throw error;
    } finally {
      clearTimeout(wallTimer);
      if (cancelEscalation) clearTimeout(cancelEscalation);
      this.activeCancel = null;
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.disposePromise = (async () => {
      try {
        if (
          this.initializeResult.agentCapabilities?.sessionCapabilities?.close
        ) {
          let closeTimer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([
            this.context
              .request(methods.agent.session.close, {
                sessionId: this.session.sessionId,
              })
              .catch(() => {}),
            new Promise<void>((resolve) => {
              closeTimer = setTimeout(resolve, CURSOR_ACP_CANCEL_GRACE_MS);
              closeTimer.unref?.();
            }),
          ]);
          if (closeTimer) clearTimeout(closeTimer);
        }
      } catch {
        // Process teardown below is authoritative.
      }
      this.session.dispose();
      this.connection.close();
      await terminateProcessTree(this.child);
      await this.workspace.dispose();
      this.diagnostics.stderr = this.stderr.summary();
    })();
    return this.disposePromise;
  }
}
