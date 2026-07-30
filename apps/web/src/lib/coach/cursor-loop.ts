import "server-only";
// Cursor Composer coach provider. Runs the official `cursor-agent` CLI as a
// subprocess in read-only `--mode ask` (which natively blocks shell/write —
// the in-process SDK has no equivalent), inside a per-turn throwaway workspace
// whose `.cursor/cli.json` permits ONLY our MCP tools and denies everything
// else. Data access is via a stdio MCP server (coach-mcp/server.ts) that
// reuses the app's real `executeTool`, scoped to `userId` threaded through the
// MCP `env`. Output is parsed from `--output-format stream-json` and
// normalized into the same Anthropic-shaped chat_messages blocks the Anthropic
// path writes, so /coach history + iOS are untouched.
//
// See memory: coach-cursor-composer-provider for the proven recipe.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, realpath, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { getUserSettings, type ChatMessageInsert } from "@/lib/db";
import { dbPath } from "@/lib/db/connection";
import { buildCursorSystemPrompt } from "./prompts";
import { CursorAgentError, resolveCursorKey } from "./cursor-key";
import type { DetailState, RunAnthropicOptions, Usage } from "./loop";
import {
  captureToolResponse,
  executeTool,
  newToolTurnState,
  redactToolPayload,
  type ToolDetail,
} from "./tools";

// Hard reaper for the cursor-agent subprocess tree, NOT a quality-of-answer
// policy. cursor-agent is spawned detached (own process group) and spawns the
// MCP server as a grandchild; nothing in the request lifecycle reaps that
// tree, so a wedged CLI would otherwise live forever against a service capped
// at 512M. Only two things can kill it: client abort, or this timer.
//
// COUPLED TO THE iOS CLIENT: `apps/ios/Sources/APIClient.swift` sets
// `request.timeoutInterval = 130`. This wall must stay BELOW that, so an
// over-running turn dies server-side as a logged `chat_logs` row instead of
// vanishing as an un-attributable client-side drop. Raising this without
// raising the iOS timeout first just moves the failure somewhere invisible.
const MAX_CURSOR_WALL_MS = 120_000;
const MAX_CURSOR_TOOL_CALLS = 12;
const MAX_TRANSCRIPT_CHARS = 8_000;
const RECENT_REFERENCE_PATTERN =
  /\b(today|tonight|right now|currently|current|this morning|last night|how am i(?: doing)?)\b/i;
const PLAN_INTENT_PATTERN = /\b(plan|program|split|routine)\b/i;
// A result event is Cursor's protocol-level terminal marker. Normally the CLI
// exits within a few milliseconds after it; cap an abnormal post-result tail
// without returning early and leaving cursor-agent/MCP children unreaped.
const TERMINAL_CLOSE_GRACE_MS = 250;

// cursor-agent registers every workspace it is pointed at under
// `~/.cursor/projects/<path-with-slashes-as-dashes>` and never reaps them.
// Our workspaces are per-turn throwaways, so without this the directory grows
// by one entry per coach turn, forever (123 had accumulated on the agent box
// and 60 on prod before this was noticed). Deleting the workspace itself is
// not enough — the registration outlives it.
//
// Best-effort by design: a failure here must never surface as a turn failure.
// On macOS the workspace path must be cleaned under BOTH spellings: tmpdir()
// there is /var/folders/... but /var is a symlink to /private/var, and
// cursor-agent registers the raw --workspace arg AND the symlink-resolved cwd
// as two separate projects. Slugging only the raw path leaves the
// `private-var-folders-...` twin behind, so the leak survives on dev machines.
// On Linux /tmp is not a symlink and both spellings collapse to one slug.
async function removeCursorProjectRegistration(workspace: string): Promise<void> {
  try {
    const home = process.env.HOME || homedir();
    if (!home) return;
    const root = path.join(home, ".cursor", "projects");
    const candidates = new Set<string>([workspace]);
    const resolved = await realpath(workspace).catch(() => null);
    if (resolved) candidates.add(resolved);

    for (const candidate of candidates) {
      // /tmp/coach-cursor-AbC123 -> tmp-coach-cursor-AbC123
      const slug = candidate.replace(/^[/\\]+/, "").replace(/[/\\]/g, "-");
      if (!slug || slug.includes("..")) continue;
      const registered = path.join(root, slug);
      // Guard against ever pointing outside the projects dir.
      if (!registered.startsWith(root + path.sep)) continue;
      await rm(registered, { recursive: true, force: true });
    }
  } catch {
    /* cleanup is best-effort */
  }
}

// Where the cursor-agent binary lives. The systemd service's PATH may not
// include ~/.local/bin, so the VM sets COACH_CURSOR_AGENT_BIN to the absolute
// path. Falls back to PATH lookup for local dev.
const CURSOR_AGENT_BIN =
  process.env.COACH_CURSOR_AGENT_BIN || "cursor-agent";

// App root (apps/web) — anchors the MCP server path and node_modules so the
// MCP subprocess (spawned from a throwaway cwd) can resolve tsx + tsconfig.
const APP_ROOT = process.env.COACH_APP_ROOT || process.cwd();
const MCP_SERVER_PATH =
  process.env.COACH_MCP_SERVER_PATH ||
  path.join(APP_ROOT, "src", "coach-mcp", "server.ts");

// Precompiled artifact from `npm run build:mcp` (esbuild, see package.json) —
// eliminates the per-turn tsx transpile of server.ts. Used in production after
// a build; falls back to the tsx invocation otherwise (local dev, or a
// COACH_MCP_SERVER_PATH override in play).
// `--conditions=react-server` is still required at the node invocation: the
// server-only import stays an external (unbundled) specifier, so its
// conditional-export resolution still happens at module-load time either way.
const COMPILED_MCP_SERVER_PATH =
  process.env.COACH_MCP_COMPILED_PATH ||
  path.join(APP_ROOT, "dist", "coach-mcp", "server.mjs");

// Under `next dev` a stale dist/ left over from an earlier `npm run build`
// would silently shadow edits to src/coach-mcp (and everything it bundles),
// so dev stays on tsx. Set COACH_MCP_USE_COMPILED=1 to force the compiled
// path anyway — e.g. benching the precompiled server against a dev server.
function preferCompiledMcpServer(): boolean {
  if (process.env.COACH_MCP_SERVER_PATH) return false;
  if (!existsSync(COMPILED_MCP_SERVER_PATH)) return false;
  if (process.env.COACH_MCP_USE_COMPILED === "1") return true;
  return process.env.NODE_ENV === "production";
}

function resolveMcpServerArgs(): string[] {
  if (preferCompiledMcpServer()) {
    return ["--conditions=react-server", COMPILED_MCP_SERVER_PATH];
  }
  return ["--conditions=react-server", "--import", "tsx", MCP_SERVER_PATH];
}

export type RunCursorTurnArgs = {
  userId: number;
  model: string;
  threadId: number;
  newUserText: string;
  conversation: MessageParam[];
  toolDetails: ToolDetail[];
  usage: Usage;
  detailState: DetailState;
  options: RunAnthropicOptions;
  accumulator?: ChatMessageInsert[];
};

export type RunCursorTurnResult = {
  reply: string;
  iterations: number;
  messages: ChatMessageInsert[];
};

export class CursorVisibleTextAccumulator {
  private segment = "";
  private finalAnswer = "";

  append(value: string): string {
    if (!value) return "";
    if (this.segment && value.startsWith(this.segment)) {
      const suffix = value.slice(this.segment.length);
      this.segment = value;
      this.finalAnswer += suffix;
      return suffix;
    }
    this.segment += value;
    this.finalAnswer += value;
    return value;
  }

  segmentBoundary(): void {
    this.segment = "";
  }

  toolBoundary(): void {
    this.segment = "";
    this.finalAnswer = "";
  }

  fallback(value: string): string {
    if (this.finalAnswer.trim() || !value) return "";
    this.finalAnswer = value;
    return value;
  }

  value(): string {
    return this.finalAnswer;
  }
}

// ---- prompt assembly -------------------------------------------------------

function messageText(m: MessageParam): string {
  const c = m.content;
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c)) {
    return c
      .filter((b): b is { type: "text"; text: string } => {
        const t = (b as { type?: unknown }).type;
        return t === "text" && typeof (b as { text?: unknown }).text === "string";
      })
      .map((b) => b.text)
      .join("")
      .trim();
  }
  return "";
}

// Flatten prior Anthropic-shaped history to a plain transcript. Composer takes
// a single prompt, not structured tool blocks; it has fresh MCP tool access, so
// prior tool_use/tool_result rows are dropped and only human-readable text is
// carried for context. Truncated to the most recent MAX_TRANSCRIPT_CHARS.
function flattenConversation(conversation: MessageParam[]): string {
  const lines: string[] = [];
  for (const m of conversation) {
    const text = messageText(m);
    if (!text) continue;
    lines.push(`${m.role === "user" ? "User" : "Assistant"}: ${text}`);
  }
  let out = lines.join("\n");
  if (out.length > MAX_TRANSCRIPT_CHARS) {
    out = "…\n" + out.slice(out.length - MAX_TRANSCRIPT_CHARS);
  }
  return out;
}

type PreloadedContext = {
  toolName:
    | "query_recovery"
    | "query_sleep"
    | "query_strain"
    | "query_workouts"
    | "query_daily_snapshot";
  dateRange: { start_date: string; end_date: string };
  data: unknown;
};

export function selectRecentPrefetchTool(
  newUserText: string,
): PreloadedContext["toolName"] | null {
  if (
    !RECENT_REFERENCE_PATTERN.test(newUserText) ||
    PLAN_INTENT_PATTERN.test(newUserText)
  ) {
    return null;
  }
  const domains = [
    {
      tool: "query_recovery" as const,
      matches: /\b(recovery|hrv|heart rate variability|rhr|resting heart rate|readiness)\b/i,
    },
    {
      tool: "query_sleep" as const,
      matches: /\b(sleep|slept|bedtime|wake time|last night)\b/i,
    },
    {
      tool: "query_strain" as const,
      matches: /\b(strain|exertion)\b/i,
    },
    {
      tool: "query_workouts" as const,
      matches: /\b(workout|workouts|train|trained|training|exercise|activity)\b/i,
    },
  ].filter(({ matches }) => matches.test(newUserText));

  if (domains.length === 1) return domains[0].tool;
  if (
    domains.length > 1 ||
    /\b(how am i(?: doing)?|how (?:was|is) today|overview|summary|status|metrics|daily check|check-?in)\b/i.test(
      newUserText,
    )
  ) {
    return "query_daily_snapshot";
  }
  return null;
}

function previousIsoDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function preloadRecentContext(
  userId: number,
  newUserText: string,
): Promise<PreloadedContext | null> {
  const toolName = selectRecentPrefetchTool(newUserText);
  if (!toolName) return null;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());
  const needsPreviousDay = /\b(last night|this morning)\b/i.test(newUserText);
  const dateRange = {
    start_date: needsPreviousDay ? previousIsoDate(today) : today,
    end_date: today,
  };
  const data = await executeTool(toolName, dateRange, {
    userId,
    turnState: newToolTurnState(),
  });
  return { toolName, dateRange, data };
}

function buildPrompt(
  userId: number,
  newUserText: string,
  conversation: MessageParam[],
  preloadedContext: PreloadedContext | null,
): string {
  const system = buildCursorSystemPrompt(
    new Date(),
    getUserSettings(userId)?.coach_goals ?? null,
  );
  // The route appends the current user message as the LAST `conversation` entry
  // before invoking the turn (same contract as the Anthropic path). Drop it here
  // so it isn't duplicated — it's surfaced under "Current request" below.
  const transcript = flattenConversation(conversation.slice(0, -1));
  return [
    system,
    preloadedContext
      ? `\n\n## Preloaded authoritative Whoop data\nThe server already ran ${preloadedContext.toolName} for ${preloadedContext.dateRange.start_date} through ${preloadedContext.dateRange.end_date} immediately before this turn. Treat this exactly like successful tool output. Do NOT call that query again for the covered dates unless the user explicitly asks you to refresh.\n${JSON.stringify(preloadedContext.data)}`
      : "",
    transcript ? `\n\n## Conversation so far\n${transcript}` : "",
    `\n\n## Current request\n${newUserText}`,
  ].join("");
}

// ---- stream-json parsing ---------------------------------------------------

type StreamEvent = {
  type?: string;
  subtype?: string;
  model?: string;
  model_call_id?: string;
  call_id?: string;
  duration_ms?: number;
  duration_api_ms?: number;
  durationMs?: number;
  durationApiMs?: number;
  is_error?: boolean;
  isError?: boolean;
  result?: unknown;
  error?: unknown;
  message?: { content?: Array<{ type?: string; text?: string }> };
  tool_call?: {
    // call id + timing live on tool_call directly and are present on BOTH the
    // `started` and `completed` events (as strings); the `started` event also
    // carries name/input under mcpToolCall.args, while `completed` carries ONLY
    // mcpToolCall.result. So name/input must be remembered from `started`.
    toolCallId?: string;
    startedAtMs?: string;
    completedAtMs?: string;
    mcpToolCall?: {
      args?: {
        toolName?: string;
        args?: unknown;
        toolCallId?: string;
      };
      result?: {
        success?: {
          isError?: boolean;
          content?: Array<{ text?: { text?: string } }>;
        };
        // A blocked call (e.g. permissionMode default without --force) returns
        // `rejected` instead of `success`. Detect it so it surfaces as an error
        // in chat_logs rather than a silent empty-ok.
        rejected?: {
          reason?: string;
          isReadonly?: boolean;
        };
      };
    };
  };
};

export type CursorTerminalResult = {
  subtype: string | null;
  isError: boolean;
  resultText: string;
  errorText: string;
  durationMs: number | null;
  apiDurationMs: number | null;
  model: string | null;
};

function nonNegativeNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : Number.NaN;
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function stringifyResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Parse Cursor's protocol-level terminal event across snake/camel variants. */
export function parseCursorTerminalResult(
  event: unknown,
): CursorTerminalResult | null {
  if (!event || typeof event !== "object") return null;
  const evt = event as StreamEvent;
  if (evt.type?.toLowerCase() !== "result") return null;

  const subtype = typeof evt.subtype === "string" ? evt.subtype : null;
  const subtypeIsError =
    subtype != null && /error|fail|cancel|timeout/i.test(subtype);
  const isError = evt.is_error === true || evt.isError === true || subtypeIsError;
  const resultText = stringifyResult(evt.result);
  const errorText = stringifyResult(evt.error) || (isError ? resultText : "");

  return {
    subtype,
    isError,
    resultText,
    errorText,
    durationMs: nonNegativeNumber(evt.duration_ms, evt.durationMs),
    apiDurationMs: nonNegativeNumber(evt.duration_api_ms, evt.durationApiMs),
    model: typeof evt.model === "string" ? evt.model : null,
  };
}

function eventCountKey(evt: StreamEvent): string {
  const type = evt.type?.trim() || "unknown";
  const subtype = evt.subtype?.trim();
  return subtype ? `${type}:${subtype}` : type;
}

function countRows(parsed: unknown): number | null {
  if (Array.isArray(parsed)) return parsed.length;
  if (parsed && typeof parsed === "object") {
    const rows = (parsed as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows.length;
  }
  return null;
}

// ---- workspace -------------------------------------------------------------

async function makeWorkspace(userId: number): Promise<string> {
  const ws = await mkdtemp(path.join(tmpdir(), "coach-cursor-"));
  try {
    const dotCursor = path.join(ws, ".cursor");
    await mkdir(dotCursor, { recursive: true });
    // Read-only containment: allow ONLY our MCP tools, deny shell/write/fetch
    // and even file reads (ask-mode can read workspace files otherwise). The
    // empty workspace + Read(**) deny means there is nothing to leak.
    await writeFile(
      path.join(dotCursor, "cli.json"),
      JSON.stringify({
        permissions: {
          allow: ["Mcp(whoop:*)"],
          deny: ["Shell(*)", "Write(**)", "WebFetch(*)", "Read(**)"],
        },
      }),
    );
    await writeFile(
      path.join(dotCursor, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          whoop: {
            command: "node",
            args: resolveMcpServerArgs(),
            cwd: APP_ROOT,
            // PATH included explicitly so `node` resolves even if a future
            // cursor-agent treats `env` as a replacement rather than a merge.
            env: {
              PATH: process.env.PATH ?? "",
              COACH_MCP_USER_ID: String(userId),
              WHOOP_DB_PATH: dbPath(),
              NODE_PATH: path.join(APP_ROOT, "node_modules"),
            },
          },
        },
      }),
    );
    return ws;
  } catch (err) {
    // Don't leak the temp dir if config writes fail before the caller's
    // finally-cleanup is in scope.
    await rm(ws, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

// ---- main ------------------------------------------------------------------

export async function runCursorTurn(
  args: RunCursorTurnArgs,
): Promise<RunCursorTurnResult> {
  args.options.signal?.throwIfAborted();
  const turnStartedMs = Date.now();
  const {
    userId,
    model,
    newUserText,
    conversation,
    toolDetails,
    detailState,
    options,
  } = args;
  const { key, origin: keyOrigin } = resolveCursorKey(userId);
  const messages: ChatMessageInsert[] = args.accumulator ?? [];

  // The user turn, persisted in the same shape as the Anthropic path.
  messages.push({
    role: "user",
    content: newUserText,
    blocks: [{ type: "text", text: newUserText }],
  });

  const selectedPrefetchTool = selectRecentPrefetchTool(newUserText);
  const shouldPrefetch = selectedPrefetchTool != null;
  const prefetchInput = { intent: "recent_context" };
  const prefetchCallId = `prefetch:${selectedPrefetchTool ?? "none"}:${turnStartedMs}`;
  if (selectedPrefetchTool) {
    options.onToolUseStart?.({
      id: prefetchCallId,
      name: selectedPrefetchTool,
      input: prefetchInput,
    });
  }
  const prefetchStartedMs = Date.now();
  let preloadedContext: PreloadedContext | null = null;
  let prefetchError: string | null = null;
  try {
    preloadedContext = await preloadRecentContext(userId, newUserText);
  } catch (error) {
    // Fail open: Cursor still has its normal MCP tools, so a transient preload
    // problem should not take down the turn.
    prefetchError = error instanceof Error ? error.message : String(error);
  }
  const prefetchMs = Date.now() - prefetchStartedMs;
  if (selectedPrefetchTool) {
    const prefetchRows =
      preloadedContext == null ? null : countRows(preloadedContext.data);
    const prefetchResponse = prefetchError
      ? { error: prefetchError }
      : captureToolResponse(preloadedContext?.data);
    toolDetails.push({
      id: prefetchCallId,
      name: selectedPrefetchTool,
      input: prefetchInput,
      duration_ms: prefetchMs,
      rows: prefetchRows,
      status: prefetchError == null ? "ok" : "error",
      ...(prefetchError ? { error: prefetchError } : {}),
      response: prefetchResponse,
    });
    options.onToolUseEnd?.({
      id: prefetchCallId,
      name: selectedPrefetchTool,
      duration_ms: prefetchMs,
      rows: prefetchRows,
      status: prefetchError == null ? "ok" : "error",
      ...(prefetchError ? { error: prefetchError } : {}),
      response: prefetchResponse,
    });
  }
  const promptStartedMs = Date.now();
  const prompt = buildPrompt(
    userId,
    newUserText,
    conversation,
    preloadedContext,
  );
  const promptBuildMs = Date.now() - promptStartedMs;
  const cursorDetail = {
    requested_model: model,
    resolved_model: null as string | null,
    prompt_chars: prompt.length,
    prefetch: {
      attempted: shouldPrefetch,
      loaded: preloadedContext != null,
      duration_ms: prefetchMs,
      tool_name: preloadedContext?.toolName ?? selectedPrefetchTool,
      date_range: preloadedContext?.dateRange ?? null,
      payload_chars:
        preloadedContext == null ? 0 : JSON.stringify(preloadedContext.data).length,
      error: prefetchError,
    },
    event_counts: {} as Record<string, number>,
    tool_events: [] as Array<{
      name: string;
      phase: "started" | "completed";
      at_ms: number;
      duration_ms?: number;
      status?: "ok" | "error";
    }>,
    terminal_subtype: null as string | null,
    terminal_seen: false,
    timing: {
      prompt_build_ms: promptBuildMs,
      workspace_prep_ms: 0,
      spawn_call_ms: 0,
      spawn_to_system_init_ms: null as number | null,
      spawn_to_first_event_ms: null as number | null,
      spawn_to_first_assistant_text_ms: null as number | null,
      spawn_to_first_tool_event_ms: null as number | null,
      spawn_to_terminal_result_ms: null as number | null,
      cursor_duration_ms: null as number | null,
      cursor_api_duration_ms: null as number | null,
      spawn_to_process_close_ms: null as number | null,
      process_close_tail_ms: null as number | null,
      cleanup_ms: 0,
      turn_ms: 0,
    },
  };
  detailState.cursor = cursorDetail;
  options.signal?.throwIfAborted();
  const workspaceStartedMs = Date.now();
  const ws = await makeWorkspace(userId);
  cursorDetail.timing.workspace_prep_ms = Date.now() - workspaceStartedMs;

  const visibleText = new CursorVisibleTextAccumulator();
  let toolCalls = 0;
  let timedOut = false;
  let stderr = "";
  let terminalError = "";
  let terminalResultText = "";
  let terminalSucceeded = false;
  // name/input/start are emitted on the `started` event and must be carried to
  // the `completed` event (which omits them), keyed by the stable call id.
  const toolMeta = new Map<string, { name: string; input: unknown; startedMs: number }>();

  try {
    const exitInfo = await new Promise<{ code: number | null }>((resolve, reject) => {
      const spawnStartedMs = Date.now();
      const child = spawn(
        CURSOR_AGENT_BIN,
        [
          "-p",
          "--model", model,
          "--mode", "ask",
          "--approve-mcps",
          "--trust",
          // --force is REQUIRED for headless MCP tool execution: as of
          // cursor-agent 2026.06.x, --approve-mcps/--trust alone leave
          // permissionMode "default", which auto-REJECTS every MCP call in -p
          // mode ("User rejected MCP: whoop-…") — the coach then sees empty
          // results and answers "Whoop queries were blocked". --force flips the
          // default to allow-unless-denied; the .cursor/cli.json deny list
          // (Shell/Write/WebFetch/Read) + --mode ask still block everything
          // except our whoop MCP tools (verified: shell stays denied under
          // --force). See thread #111 post-mortem.
          "--force",
          "--workspace", ws,
          "--output-format", "stream-json",
          "--stream-partial-output",
          prompt,
        ],
        {
          cwd: ws,
          env: { ...process.env, CURSOR_API_KEY: key },
          stdio: ["ignore", "pipe", "pipe"],
          // New process group so we can signal cursor-agent AND its MCP-server
          // grandchild together via process.kill(-pid) on abort/timeout.
          detached: true,
        },
      );
      cursorDetail.timing.spawn_call_ms = Date.now() - spawnStartedMs;

      let killEscalation: ReturnType<typeof setTimeout> | undefined;
      let terminalCloseTimer: ReturnType<typeof setTimeout> | undefined;
      // Signal the whole process group; fall back to the direct child if the
      // group send fails (e.g. pid already reaped).
      const killTree = (signal: NodeJS.Signals) => {
        if (child.pid === undefined) return;
        try {
          process.kill(-child.pid, signal);
        } catch {
          try {
            child.kill(signal);
          } catch {
            /* already gone */
          }
        }
      };
      const terminate = () => {
        killTree("SIGTERM");
        if (!killEscalation) {
          killEscalation = setTimeout(() => killTree("SIGKILL"), 5_000);
          killEscalation.unref?.();
        }
      };
      const capTerminalTail = () => {
        if (terminalCloseTimer) return;
        terminalCloseTimer = setTimeout(terminate, TERMINAL_CLOSE_GRACE_MS);
        terminalCloseTimer.unref?.();
      };

      const killTimer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, MAX_CURSOR_WALL_MS);

      const onAbort = () => terminate();
      options.signal?.addEventListener("abort", onAbort, { once: true });
      // addEventListener does not replay an abort that happened while the
      // prompt/workspace was being prepared. Close that race explicitly.
      if (options.signal?.aborted) terminate();

      const stdout = child.stdout;
      const stderrStream = child.stderr;
      if (!stdout || !stderrStream) {
        clearTimeout(killTimer);
        terminate();
        options.signal?.removeEventListener("abort", onAbort);
        reject(new Error("cursor-agent stdio unavailable"));
        return;
      }
      let buf = "";
      const processLine = (rawLine: string) => {
        const line = rawLine.trim();
        if (!line) return;
        let evt: StreamEvent;
        try {
          evt = JSON.parse(line) as StreamEvent;
        } catch {
          return;
        }
        try {
          handleEvent(evt);
        } catch (err) {
          // A cap breach kills the whole tree; surface via reject path.
          clearTimeout(killTimer);
          terminate();
          options.signal?.removeEventListener("abort", onAbort);
          reject(err);
        }
      };
      stdout.setEncoding("utf8");
      stdout.on("data", (chunk: string) => {
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          processLine(line);
        }
      });
      stderrStream.setEncoding("utf8");
      stderrStream.on("data", (chunk: string) => {
        stderr += chunk;
        if (stderr.length > 4_000) stderr = stderr.slice(-4_000);
      });

      child.on("error", (err) => {
        clearTimeout(killTimer);
        if (killEscalation) clearTimeout(killEscalation);
        if (terminalCloseTimer) clearTimeout(terminalCloseTimer);
        options.signal?.removeEventListener("abort", onAbort);
        reject(err);
      });
      child.on("close", (code) => {
        // Cursor normally newline-terminates stream-json records, but retain a
        // valid terminal record even if a CLI version closes directly after it.
        if (buf.trim()) {
          processLine(buf);
          buf = "";
        }
        clearTimeout(killTimer);
        if (killEscalation) clearTimeout(killEscalation);
        if (terminalCloseTimer) clearTimeout(terminalCloseTimer);
        options.signal?.removeEventListener("abort", onAbort);
        const closeElapsedMs = Date.now() - spawnStartedMs;
        cursorDetail.timing.spawn_to_process_close_ms = closeElapsedMs;
        const terminalElapsedMs =
          cursorDetail.timing.spawn_to_terminal_result_ms;
        cursorDetail.timing.process_close_tail_ms =
          terminalElapsedMs == null
            ? null
            : Math.max(0, closeElapsedMs - terminalElapsedMs);
        resolve({ code });
      });

      function handleEvent(evt: StreamEvent) {
        const elapsedMs = Date.now() - spawnStartedMs;
        if (cursorDetail.timing.spawn_to_first_event_ms == null) {
          cursorDetail.timing.spawn_to_first_event_ms = elapsedMs;
        }
        const countKey = eventCountKey(evt);
        cursorDetail.event_counts[countKey] =
          (cursorDetail.event_counts[countKey] ?? 0) + 1;

        if (
          evt.type?.toLowerCase() === "system" &&
          evt.subtype?.toLowerCase() === "init"
        ) {
          cursorDetail.timing.spawn_to_system_init_ms ??= elapsedMs;
          if (typeof evt.model === "string") {
            cursorDetail.resolved_model = evt.model;
          }
          return;
        }

        const terminal = parseCursorTerminalResult(evt);
        if (terminal) {
          cursorDetail.terminal_seen = true;
          cursorDetail.terminal_subtype = terminal.subtype;
          cursorDetail.timing.spawn_to_terminal_result_ms ??= elapsedMs;
          cursorDetail.timing.cursor_duration_ms = terminal.durationMs;
          cursorDetail.timing.cursor_api_duration_ms = terminal.apiDurationMs;
          if (terminal.model) cursorDetail.resolved_model = terminal.model;
          terminalResultText = terminal.resultText;
          terminalError = terminal.isError ? terminal.errorText : "";
          terminalSucceeded = !terminal.isError;
          capTerminalTail();
          return;
        }

        // Assistant text. With --stream-partial-output the model emits a run of
        // incremental token fragments, then a cumulative full-segment snapshot.
        // The snapshot is NOT reliably tagged (model_call_id is present on some
        // turns, absent on others), so dedup by CONTENT: a cumulative snapshot
        // starts with the segment accumulated so far → emit only its new suffix
        // (usually empty). True token fragments don't start with the
        // accumulation, so they append whole. `segText` resets at each segment
        // boundary (tool_call / thinking).
        if (evt.type === "assistant") {
          const parts = evt.message?.content ?? [];
          let text = "";
          for (const p of parts) {
            if (p.type === "text" && typeof p.text === "string") text += p.text;
          }
          if (!text) return;
          cursorDetail.timing.spawn_to_first_assistant_text_ms ??= elapsedMs;
          const delta = visibleText.append(text);
          if (delta) options.onTextDelta?.(delta);
          return;
        }
        if (evt.type === "thinking") {
          visibleText.segmentBoundary();
          return;
        }
        if (evt.type === "tool_call") {
          cursorDetail.timing.spawn_to_first_tool_event_ms ??= elapsedMs;
          visibleText.segmentBoundary();
          const tc = evt.tool_call;
          // call_id is stable across started/completed; fall back through the
          // other id carriers, then a random id only as a last resort.
          const callId =
            evt.call_id ??
            tc?.toolCallId ??
            tc?.mcpToolCall?.args?.toolCallId ??
            randomUUID();
          if (evt.subtype === "started") {
            const a = tc?.mcpToolCall?.args;
            // Cursor also emits internal MCP bookkeeping calls through the
            // same outer event type. They have no mcpToolCall.args.toolName
            // and are not Coach tools: keep them in event_counts, but do not
            // surface/persist a fake `unknown` tool round trip.
            if (!a?.toolName) return;
            const name = a.toolName;
            // Everything emitted before a real tool boundary is operational
            // commentary. The final visible answer starts fresh after tools.
            visibleText.toolBoundary();
            const startedMs = Number(tc?.startedAtMs) || Date.now();
            toolMeta.set(callId, { name, input: a?.args, startedMs });
            cursorDetail.tool_events.push({
              name,
              phase: "started",
              at_ms: elapsedMs,
            });
            options.onToolUseStart?.({
              id: callId,
              name,
              input: redactToolPayload(a?.args),
            });
            return;
          }
          if (evt.subtype === "completed") {
            const meta = toolMeta.get(callId);
            if (!meta) return;
            toolCalls += 1;
            toolMeta.delete(callId);
            const name = meta.name;
            const input = meta.input;
            const startedMs =
              meta.startedMs ?? (Number(tc?.startedAtMs) || Date.now());
            const completedMs = Number(tc?.completedAtMs) || Date.now();
            const durationMs = Math.max(0, completedMs - startedMs);
            const result = tc?.mcpToolCall?.result;
            const rejected = result?.rejected;
            const success = result?.success;
            const isError = rejected != null || success?.isError === true;
            cursorDetail.tool_events.push({
              name,
              phase: "completed",
              at_ms: elapsedMs,
              duration_ms: durationMs,
              status: isError ? "error" : "ok",
            });
            const resultText = rejected
              ? `MCP call rejected: ${rejected.reason ?? "unknown reason"}`
              : success?.content?.[0]?.text?.text ?? "";
            let parsed: unknown = resultText;
            try {
              parsed = JSON.parse(resultText);
            } catch {
              /* keep raw string */
            }
            const rows = rejected ? null : countRows(parsed);
            toolDetails.push({
              id: callId,
              name,
              input,
              duration_ms: durationMs,
              rows,
              status: isError ? "error" : "ok",
              ...(isError ? { error: resultText.slice(0, 200) } : {}),
              response: parsed,
            });
            options.onToolUseEnd?.({
              id: callId,
              name,
              duration_ms: durationMs,
              rows,
              status: isError ? "error" : "ok",
              ...(isError ? { error: resultText.slice(0, 200) } : {}),
              response: captureToolResponse(parsed),
            });
            // Persist Anthropic-shaped tool_use + tool_result rows. These are
            // auto-filtered from /coach history (same as the Anthropic path)
            // but reload into model input on a follow-up turn.
            messages.push({
              role: "assistant",
              content: "",
              blocks: [{ type: "tool_use", id: callId, name, input: input ?? {} }],
            });
            messages.push({
              role: "user",
              content: "[tool_result]",
              blocks: [
                {
                  type: "tool_result",
                  tool_use_id: callId,
                  content: resultText,
                  ...(isError ? { is_error: true } : {}),
                },
              ],
            });
            if (toolCalls > MAX_CURSOR_TOOL_CALLS) {
              throw new CursorAgentError(
                "agent",
                `Cursor turn exceeded ${MAX_CURSOR_TOOL_CALLS} tool calls`,
              );
            }
            return;
          }
        }
      }
    });

    options.signal?.throwIfAborted();
    if (timedOut) {
      throw new CursorAgentError("timeout", "Cursor coach timed out");
    }
    if (terminalError) {
      throw new CursorAgentError(
        "agent",
        `Cursor agent failed: ${terminalError.slice(0, 200)}`,
      );
    }
    const fallbackDelta = visibleText.fallback(terminalResultText);
    if (fallbackDelta) {
      options.onTextDelta?.(fallbackDelta);
    }
    if (exitInfo.code !== 0 && !terminalSucceeded && !visibleText.value()) {
      const auth = /unauthor|forbidden|invalid.*key|401|403/i.test(stderr);
      throw new CursorAgentError(
        auth ? "auth" : "agent",
        auth
          ? "Cursor API key rejected"
          : `cursor-agent exited ${exitInfo.code}: ${stderr.slice(0, 200)}`,
        auth ? keyOrigin : undefined,
      );
    }

    const reply = visibleText.value().trim();
    messages.push({
      role: "assistant",
      content: reply,
      blocks: [{ type: "text", text: reply }],
    });
    detailState.iterations = toolCalls + 1;
    return { reply, iterations: toolCalls + 1, messages };
  } catch (err) {
    if (err instanceof CursorAgentError) throw err;
    if (options.signal?.aborted) throw err;
    throw new CursorAgentError(
      "agent",
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    const cleanupStartedMs = Date.now();
    // Unregister BEFORE deleting the workspace: resolving the symlinked
    // spelling of the path (macOS /var -> /private/var) requires the
    // directory to still exist.
    await removeCursorProjectRegistration(ws);
    await rm(ws, { recursive: true, force: true }).catch(() => {});
    cursorDetail.timing.cleanup_ms = Date.now() - cleanupStartedMs;
    cursorDetail.timing.turn_ms = Date.now() - turnStartedMs;
  }
}
