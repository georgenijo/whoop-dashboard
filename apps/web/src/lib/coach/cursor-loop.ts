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
import { mkdtemp, mkdir, writeFile, realpath, rm, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
import {
  flattenCursorConversation,
  selectActiveImageContext,
} from "./conversation";
import type {
  CoachConversationMessage,
  CoachImage,
  CoachUserTurn,
} from "./image-types";
import {
  cursorModelArgument,
  isCursorReasoningParameter,
  type CursorModelParameterSelection,
} from "./cursor-model-params";
import cursorLauncherTools from "./cursor-launcher-tools.json";

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

function isViewChatImageTool(name: string): boolean {
  return name === "view_chat_image" || name.endsWith("-view_chat_image");
}

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
export async function removeCursorProjectRegistration(
  workspace: string,
): Promise<void> {
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
// include ~/.local/bin, so production sets COACH_CURSOR_AGENT_BIN to the
// absolute path. Falls back to PATH lookup for local dev.
export const CURSOR_AGENT_BIN =
  process.env.COACH_CURSOR_AGENT_BIN || "cursor-agent";

/**
 * Cursor starts a TypeScript language server through `npx` for every workspace,
 * even when the workspace is our empty, read-denied per-turn sandbox. On the
 * 512M production service that unnecessary process costs roughly 120M RSS.
 *
 * Denying the LSP means keeping `npx` unresolvable, but PATH cannot simply be
 * emptied: the installed `cursor-agent` entrypoint is not a binary, it is a
 * bash launcher (`#!/usr/bin/env bash`) that needs `bash` plus a few coreutils
 * from PATH before it execs its bundled Node. An empty PATH fails the shebang
 * with exit 127 before Cursor even starts (thread 126 post-mortem) — and
 * `npx` lives in /usr/bin right next to `bash`, so no system directory gives
 * one without the other. Instead each turn workspace carries a shim bin dir
 * symlinking exactly the tools the launcher uses and nothing else; PATH points
 * only there. Cursor treats the missing `npx` as an unavailable optional LSP
 * and continues with a no-op diagnostics provider.
 *
 * Keep the inherited PATH for the `cursor-agent` name fallback used by local
 * development, where the binary itself still needs PATH resolution.
 */
export function cursorAgentChildPath(
  agentBin: string,
  parentPath: string | undefined,
  override: string | undefined,
  shimBinDir: string,
): string | undefined {
  if (!path.isAbsolute(agentBin)) return parentPath;
  return override ?? shimBinDir;
}

// Everything the cursor-agent bash launcher resolves via PATH: `bash` for the
// `#!/usr/bin/env bash` shebang (env itself is kernel-resolved by absolute
// path), then basename/dirname + realpath-or-readlink for symlink resolution;
// `env` is defensive. The bundled Node it execs is addressed absolutely, so
// nothing beyond these is needed. If a future launcher revision adds a tool,
// the turn fails as `cursor-agent exited 127` in chat_logs — extend this list.
const CURSOR_LAUNCHER_TOOLS = cursorLauncherTools;
const SHIM_BIN_DIRNAME = ".shim-bin";

export function shimBinDirFor(ws: string): string {
  return path.join(ws, SHIM_BIN_DIRNAME);
}

export async function prepareCursorShimBin(
  ws: string,
  parentPath: string | undefined,
): Promise<string> {
  const shimDir = shimBinDirFor(ws);
  await mkdir(shimDir, { recursive: true });
  const searchDirs = (parentPath ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .concat(["/usr/bin", "/bin", "/usr/local/bin"]);
  for (const tool of CURSOR_LAUNCHER_TOOLS) {
    const source = searchDirs
      .map((dir) => path.join(dir, tool))
      .find((candidate) => existsSync(candidate));
    if (!source) {
      console.warn(
        `[coach] cursor shim: '${tool}' not found in any PATH dir; launcher may exit 127`,
      );
      continue;
    }
    try {
      await symlink(source, path.join(shimDir, tool));
    } catch (err) {
      console.warn(`[coach] cursor shim: failed to link '${tool}':`, err);
    }
  }
  return shimDir;
}

// App root (apps/web) — anchors the MCP server path and node_modules so the
// MCP subprocess (spawned from a throwaway cwd) can resolve tsx + tsconfig.
export const CURSOR_APP_ROOT = process.env.COACH_APP_ROOT || process.cwd();
const MCP_SERVER_PATH =
  process.env.COACH_MCP_SERVER_PATH ||
  path.join(CURSOR_APP_ROOT, "src", "coach-mcp", "server.ts");

// Precompiled artifact from `npm run build:mcp` (esbuild, see package.json) —
// eliminates the per-turn tsx transpile of server.ts. Used in production after
// a build; falls back to the tsx invocation otherwise (local dev, or a
// COACH_MCP_SERVER_PATH override in play).
// `--conditions=react-server` is still required at the node invocation: the
// server-only import stays an external (unbundled) specifier, so its
// conditional-export resolution still happens at module-load time either way.
const COMPILED_MCP_SERVER_PATH =
  process.env.COACH_MCP_COMPILED_PATH ||
  path.join(CURSOR_APP_ROOT, "dist", "coach-mcp", "server.mjs");

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

export function resolveMcpServerArgs(requireCompiled = false): string[] {
  if (requireCompiled) {
    if (!existsSync(COMPILED_MCP_SERVER_PATH)) {
      throw new Error(
        "Cursor ACP requires the compiled Coach MCP server; run npm run build:mcp",
      );
    }
    return ["--conditions=react-server", COMPILED_MCP_SERVER_PATH];
  }
  if (preferCompiledMcpServer()) {
    return ["--conditions=react-server", COMPILED_MCP_SERVER_PATH];
  }
  return ["--conditions=react-server", "--import", "tsx", MCP_SERVER_PATH];
}

export type RunCursorTurnArgs = {
  userId: number;
  model: string;
  modelParameters?: CursorModelParameterSelection[];
  threadId: number;
  turn: CoachUserTurn;
  conversation: CoachConversationMessage[];
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

function truncateTranscript(transcript: string): string {
  let out = transcript;
  if (out.length > MAX_TRANSCRIPT_CHARS) {
    out = "…\n" + out.slice(out.length - MAX_TRANSCRIPT_CHARS);
  }
  return out;
}

export type CursorPreloadedContext = {
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
): CursorPreloadedContext["toolName"] | null {
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

export async function preloadRecentContext(
  userId: number,
  newUserText: string,
): Promise<CursorPreloadedContext | null> {
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

export function buildCursorPrompt(
  userId: number,
  turn: CoachUserTurn,
  conversation: CoachConversationMessage[],
  activeIds: ReadonlySet<string>,
  preloadedContext: CursorPreloadedContext | null,
  includeBootstrap = true,
  bootstrapPrompt?: string,
): string {
  // Issue #498 — the user's Settings "Instructions" apply on the Cursor path
  // too, appended additively (see buildCursorSystemPrompt). One settings read
  // now serves both goals and instructions.
  const system = includeBootstrap
    ? (bootstrapPrompt ?? cursorSystemPromptForUser(userId))
    : "";
  const transcript = truncateTranscript(
    flattenCursorConversation(conversation, activeIds),
  );
  const currentImageMarkers = turn.images.map(
    (image) =>
      `[Attached image ${image.id}; call view_chat_image with this attachment_id before analyzing it.]`,
  );
  return [
    system,
    preloadedContext
      ? `\n\n## Preloaded authoritative Whoop data\nThe server already ran ${preloadedContext.toolName} for ${preloadedContext.dateRange.start_date} through ${preloadedContext.dateRange.end_date} immediately before this turn. Treat this exactly like successful tool output. Do NOT call that query again for the covered dates unless the user explicitly asks you to refresh.\n${JSON.stringify(preloadedContext.data)}`
      : "",
    includeBootstrap && transcript
      ? `\n\n## Conversation so far\n${transcript}`
      : "",
    `\n\n## Current request\n${[...currentImageMarkers, turn.modelText].join("\n")}`,
  ].join("");
}

export function cursorSystemPromptForUser(userId: number): string {
  const userSettings = getUserSettings(userId);
  return buildCursorSystemPrompt(
    new Date(),
    userSettings?.coach_goals ?? null,
    userSettings?.system_prompt ?? null,
  );
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
  // Present on the terminal `result` event only, camelCase unlike
  // Anthropic's snake_case equivalents — see parseCursorTerminalResult.
  usage?: {
    inputTokens?: unknown;
    outputTokens?: unknown;
    cacheReadTokens?: unknown;
    cacheWriteTokens?: unknown;
  };
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

// Cursor's terminal `result` event usage snapshot. One cumulative snapshot
// per subprocess invocation (not per internal model round-trip); no
// "totalTokens" field. cacheWriteTokens maps onto our
// cache_creation_input_tokens_total (cursor-agent itself subtracts
// cache-read + cache-write out of inputTokens before emitting, so the four
// buckets are disjoint — same partition Anthropic uses).
export type CursorUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type CursorTerminalResult = {
  subtype: string | null;
  isError: boolean;
  resultText: string;
  errorText: string;
  durationMs: number | null;
  apiDurationMs: number | null;
  model: string | null;
  usage: CursorUsage | null;
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
  const rawUsage = evt.usage;
  // Require at least one recognized key before trusting this as a usage
  // payload. `{}` or a renamed-field object (e.g. a future cursor-agent
  // build that ships `input_tokens` instead of `inputTokens`) would
  // otherwise fall through every `?? 0` and still produce a non-null
  // CursorUsage — persisting `calls: 1` next to four zeros, which reads as
  // "verified zero-cost turn" on /logs instead of the "no usage data"
  // signal a null usage (and calls: 0) gives today. That would silently
  // reintroduce issue #443 in a harder-to-notice form.
  const hasRecognizedUsageKey =
    rawUsage != null &&
    typeof rawUsage === "object" &&
    ("inputTokens" in rawUsage ||
      "outputTokens" in rawUsage ||
      "cacheReadTokens" in rawUsage ||
      "cacheWriteTokens" in rawUsage);
  const usage: CursorUsage | null = hasRecognizedUsageKey
    ? {
        inputTokens: nonNegativeNumber(rawUsage.inputTokens) ?? 0,
        outputTokens: nonNegativeNumber(rawUsage.outputTokens) ?? 0,
        cacheReadTokens: nonNegativeNumber(rawUsage.cacheReadTokens) ?? 0,
        cacheWriteTokens: nonNegativeNumber(rawUsage.cacheWriteTokens) ?? 0,
      }
    : null;

  return {
    subtype,
    isError,
    resultText,
    errorText,
    durationMs: nonNegativeNumber(evt.duration_ms, evt.durationMs),
    apiDurationMs: nonNegativeNumber(evt.duration_api_ms, evt.durationApiMs),
    model: typeof evt.model === "string" ? evt.model : null,
    usage,
  };
}

function eventCountKey(evt: StreamEvent): string {
  const type = evt.type?.trim() || "unknown";
  const subtype = evt.subtype?.trim();
  return subtype ? `${type}:${subtype}` : type;
}

export function countCursorRows(parsed: unknown): number | null {
  if (Array.isArray(parsed)) return parsed.length;
  if (parsed && typeof parsed === "object") {
    const rows = (parsed as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows.length;
  }
  return null;
}

// ---- workspace -------------------------------------------------------------

async function makeWorkspace(userId: number, images: CoachImage[]): Promise<string> {
  const ws = await mkdtemp(path.join(tmpdir(), "coach-cursor-"));
  try {
    const dotCursor = path.join(ws, ".cursor");
    const attachmentDir = path.join(ws, "attachments");
    const manifestPath = path.join(ws, "attachment-manifest.json");
    await mkdir(dotCursor, { recursive: true });
    await mkdir(attachmentDir, { recursive: true, mode: 0o700 });
    await prepareCursorShimBin(ws, process.env.PATH);
    const manifest: Record<string, string> = {};
    for (const image of images) {
      const imagePath = path.join(attachmentDir, `${image.id}.jpg`);
      await writeFile(imagePath, image.bytes, { mode: 0o600 });
      manifest[image.id] = imagePath;
    }
    await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
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
            // Absolute so cursor-agent does not need a general PATH merely to
            // launch the one approved MCP subprocess.
            command: process.execPath,
            args: resolveMcpServerArgs(),
            cwd: CURSOR_APP_ROOT,
            // PATH included explicitly so `node` resolves even if a future
            // cursor-agent treats `env` as a replacement rather than a merge.
            env: {
              PATH: process.env.PATH ?? "",
              COACH_MCP_USER_ID: String(userId),
              COACH_MCP_ATTACHMENT_MANIFEST: manifestPath,
              WHOOP_DB_PATH: dbPath(),
              NODE_PATH: path.join(CURSOR_APP_ROOT, "node_modules"),
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
    modelParameters = [],
    turn,
    conversation,
    toolDetails,
    usage,
    detailState,
    options,
  } = args;
  const { key, origin: keyOrigin } = resolveCursorKey(userId);
  const modelArgument = cursorModelArgument(model, modelParameters);
  detailState.effort = modelParameters.find((parameter) =>
    isCursorReasoningParameter({
      id: parameter.id,
      display_name: null,
    }),
  )?.value;
  const messages: ChatMessageInsert[] = args.accumulator ?? [];

  // The user turn, persisted in the same shape as the Anthropic path.
  messages.push({
    role: "user",
    content: turn.displayText,
    blocks: turn.displayText
      ? [{ type: "text", text: turn.displayText }]
      : [],
    attachments: turn.images,
  });

  const selectedPrefetchTool = selectRecentPrefetchTool(turn.modelText);
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
  let preloadedContext: CursorPreloadedContext | null = null;
  let prefetchError: string | null = null;
  try {
    preloadedContext = await preloadRecentContext(userId, turn.modelText);
  } catch (error) {
    // Fail open: Cursor still has its normal MCP tools, so a transient preload
    // problem should not take down the turn.
    prefetchError = error instanceof Error ? error.message : String(error);
  }
  const prefetchMs = Date.now() - prefetchStartedMs;
  if (selectedPrefetchTool) {
    const prefetchRows =
      preloadedContext == null ? null : countCursorRows(preloadedContext.data);
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
  const imageContext = selectActiveImageContext(conversation, turn);
  const promptStartedMs = Date.now();
  const prompt = buildCursorPrompt(
    userId,
    turn,
    conversation,
    imageContext.activeIds,
    preloadedContext,
  );
  const promptBuildMs = Date.now() - promptStartedMs;
  const cursorDetail = {
    requested_model: model,
    requested_parameters: modelParameters,
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
    // Counts every `started` tool_call event that carries a real MCP tool
    // name (see the `!a?.toolName` guard below, which excludes internal MCP
    // bookkeeping calls) — not just completed ones, so a hung tool call that
    // never finishes still shows up here. May exceed the completed count in
    // `tool_events`.
    attempted_tool_calls: 0,
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
      // Set only on an early-exit reject (stdio unavailable, a mid-stream
      // cap breach, or a child `error`) — the process is only SIGTERM'd at
      // that point, so `close` (and spawn_to_process_close_ms above) can
      // still arrive later with the real close time. Kept as a separate
      // field rather than reusing spawn_to_process_close_ms so that field
      // keeps meaning "the process actually closed" for scripts/BENCH.md.
      spawn_to_early_exit_ms: null as number | null,
      cleanup_ms: 0,
      turn_ms: 0,
    },
  };
  detailState.cursor = cursorDetail;
  options.signal?.throwIfAborted();
  const workspaceStartedMs = Date.now();
  const ws = await makeWorkspace(userId, imageContext.images);
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
          "--model", modelArgument,
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
          env: {
            ...process.env,
            PATH: cursorAgentChildPath(
              CURSOR_AGENT_BIN,
              process.env.PATH,
              process.env.COACH_CURSOR_CHILD_PATH,
              shimBinDirFor(ws),
            ),
            CURSOR_API_KEY: key,
          },
          stdio: ["ignore", "pipe", "pipe"],
          // New process group so we can signal cursor-agent AND its MCP-server
          // grandchild together via process.kill(-pid) on abort/timeout.
          detached: true,
        },
      );
      cursorDetail.timing.spawn_call_ms = Date.now() - spawnStartedMs;

      // A reject on an early-exit path (stdio unavailable, a mid-stream cap
      // breach, or a child `error`) only SIGTERMs the child — the real
      // `close` event can still arrive later and must still set
      // spawn_to_process_close_ms itself (see the close handler below).
      // Capture what was actually observed at reject time into its own
      // field instead, so it's never confused with "the process closed".
      // Idempotent: first caller wins.
      let earlyExitTimingCaptured = false;
      const captureEarlyExitTiming = () => {
        if (earlyExitTimingCaptured) return;
        earlyExitTimingCaptured = true;
        cursorDetail.timing.spawn_to_early_exit_ms = Date.now() - spawnStartedMs;
      };

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
        captureEarlyExitTiming();
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
          captureEarlyExitTiming();
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
        captureEarlyExitTiming();
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
        const terminalElapsedMs = cursorDetail.timing.spawn_to_terminal_result_ms;
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
          // Issue #443 — Cursor DOES report usage on the terminal result
          // event (see the StreamEvent.usage doc comment); thread it into
          // the same Usage totals the Anthropic path populates so chat_logs
          // stops persisting all-zero cost signal for the Cursor provider.
          //
          // usage.calls means something different per provider: on the
          // Anthropic path it counts model round-trips (one per tool-use
          // iteration); here it is 0 (no usage observed) or 1 (one terminal
          // snapshot per subprocess invocation), regardless of how many
          // internal tool calls or model round-trips cursor-agent made under
          // the hood. /logs renders both in a single "Calls" cell — a
          // six-tool-round-trip Cursor turn still reads "Calls 1".
          if (terminal.usage) {
            usage.input_tokens_total += terminal.usage.inputTokens;
            usage.output_tokens_total += terminal.usage.outputTokens;
            usage.cache_read_input_tokens_total += terminal.usage.cacheReadTokens;
            usage.cache_creation_input_tokens_total += terminal.usage.cacheWriteTokens;
            usage.calls += 1;
          }
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
            cursorDetail.attempted_tool_calls += 1;
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
            if (isViewChatImageTool(name)) {
              options.onToolProgress?.({
                id: callId,
                tool: name,
                stage: "reviewing",
                message: "Reviewing image…",
              });
            }
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
            if (isViewChatImageTool(name)) {
              const attachmentId =
                input &&
                typeof input === "object" &&
                typeof (input as { attachment_id?: unknown }).attachment_id === "string"
                  ? (input as { attachment_id: string }).attachment_id
                  : "unknown";
              toolDetails.push({
                id: callId,
                name,
                input: { attachment_id: attachmentId },
                duration_ms: durationMs,
                rows: null,
                status: isError ? "error" : "ok",
                ...(isError ? { error: "Image retrieval failed." } : {}),
              });
              options.onToolUseEnd?.({
                id: callId,
                name,
                duration_ms: durationMs,
                rows: null,
                status: isError ? "error" : "ok",
                ...(isError ? { error: "Image retrieval failed." } : {}),
              });
              if (toolCalls > MAX_CURSOR_TOOL_CALLS) {
                throw new CursorAgentError(
                  "agent",
                  `Cursor turn exceeded ${MAX_CURSOR_TOOL_CALLS} tool calls`,
                );
              }
              return;
            }
            let parsed: unknown = resultText;
            try {
              parsed = JSON.parse(resultText);
            } catch {
              /* keep raw string */
            }
            const rows = rejected ? null : countCursorRows(parsed);
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
