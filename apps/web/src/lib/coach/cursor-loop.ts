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
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { getUserSettings, type ChatMessageInsert } from "@/lib/db";
import { dbPath } from "@/lib/db/connection";
import { buildSystemPrompt } from "./prompts";
import { CURSOR_COMPOSER_MODEL } from "./provider";
import { CursorAgentError, resolveCursorKey } from "./cursor-key";
import type { DetailState, RunAnthropicOptions, Usage } from "./loop";
import type { ToolDetail } from "./tools";

const MAX_CURSOR_WALL_MS = 120_000;
const MAX_CURSOR_TOOL_CALLS = 12;
const MAX_TRANSCRIPT_CHARS = 8_000;

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

export type RunCursorTurnArgs = {
  userId: number;
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

function buildPrompt(userId: number, newUserText: string, conversation: MessageParam[]): string {
  const system = buildSystemPrompt(
    new Date(),
    getUserSettings(userId)?.coach_goals ?? null,
  )
    .map((b) => b.text)
    .join("\n\n");
  // The route appends the current user message as the LAST `conversation` entry
  // before invoking the turn (same contract as the Anthropic path). Drop it here
  // so it isn't duplicated — it's surfaced under "Current request" below.
  const transcript = flattenConversation(conversation.slice(0, -1));
  return [
    system,
    "\n\nNote: trigger_whoop_sync is unavailable in this mode. Answer from existing data; if a recent date has no rows, say so plainly rather than trying to sync.",
    transcript ? `\n\n## Conversation so far\n${transcript}` : "",
    `\n\n## Current request\n${newUserText}`,
  ].join("");
}

// ---- stream-json parsing ---------------------------------------------------

type StreamEvent = {
  type?: string;
  subtype?: string;
  model_call_id?: string;
  call_id?: string;
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
            args: ["--conditions=react-server", "--import", "tsx", MCP_SERVER_PATH],
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
  const { userId, newUserText, conversation, toolDetails, detailState, options } = args;
  const key = resolveCursorKey();
  const messages: ChatMessageInsert[] = args.accumulator ?? [];

  // The user turn, persisted in the same shape as the Anthropic path.
  messages.push({
    role: "user",
    content: newUserText,
    blocks: [{ type: "text", text: newUserText }],
  });

  const prompt = buildPrompt(userId, newUserText, conversation);
  const ws = await makeWorkspace(userId);

  let reply = "";
  let segText = ""; // current assistant segment, for snapshot dedup
  let toolCalls = 0;
  let timedOut = false;
  let stderr = "";
  // name/input/start are emitted on the `started` event and must be carried to
  // the `completed` event (which omits them), keyed by the stable call id.
  const toolMeta = new Map<string, { name: string; input: unknown; startedMs: number }>();

  try {
    const exitInfo = await new Promise<{ code: number | null }>((resolve, reject) => {
      const child = spawn(
        CURSOR_AGENT_BIN,
        [
          "-p",
          "--model", CURSOR_COMPOSER_MODEL,
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

      let killEscalation: ReturnType<typeof setTimeout> | undefined;
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

      const killTimer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, MAX_CURSOR_WALL_MS);

      const onAbort = () => terminate();
      options.signal?.addEventListener("abort", onAbort, { once: true });

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
      stdout.setEncoding("utf8");
      stdout.on("data", (chunk: string) => {
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let evt: StreamEvent;
          try {
            evt = JSON.parse(line) as StreamEvent;
          } catch {
            continue;
          }
          try {
            handleEvent(evt);
          } catch (err) {
            // A cap breach kills the whole tree; surface via reject path.
            clearTimeout(killTimer);
            terminate();
            options.signal?.removeEventListener("abort", onAbort);
            reject(err);
            return;
          }
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
        options.signal?.removeEventListener("abort", onAbort);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(killTimer);
        if (killEscalation) clearTimeout(killEscalation);
        options.signal?.removeEventListener("abort", onAbort);
        resolve({ code });
      });

      function handleEvent(evt: StreamEvent) {
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
          if (segText && text.startsWith(segText)) {
            const suffix = text.slice(segText.length);
            segText = text;
            if (suffix) {
              reply += suffix;
              options.onTextDelta?.(suffix);
            }
          } else {
            segText += text;
            reply += text;
            options.onTextDelta?.(text);
          }
          return;
        }
        if (evt.type === "thinking") {
          segText = ""; // segment boundary
          return;
        }
        if (evt.type === "tool_call") {
          segText = ""; // segment boundary
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
            const name = a?.toolName ?? "unknown";
            const startedMs = Number(tc?.startedAtMs) || Date.now();
            toolMeta.set(callId, { name, input: a?.args, startedMs });
            options.onToolUseStart?.({ name, input: a?.args });
            return;
          }
          if (evt.subtype === "completed") {
            toolCalls += 1;
            const meta = toolMeta.get(callId);
            toolMeta.delete(callId);
            const name = meta?.name ?? "unknown";
            const input = meta?.input;
            const startedMs =
              meta?.startedMs ?? (Number(tc?.startedAtMs) || Date.now());
            const completedMs = Number(tc?.completedAtMs) || Date.now();
            const durationMs = Math.max(0, completedMs - startedMs);
            const result = tc?.mcpToolCall?.result;
            const rejected = result?.rejected;
            const success = result?.success;
            const isError = rejected != null || success?.isError === true;
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
              name,
              input,
              duration_ms: durationMs,
              rows,
              status: isError ? "error" : "ok",
              ...(isError ? { error: resultText.slice(0, 200) } : {}),
              response: parsed,
            });
            options.onToolUseEnd?.({
              name,
              duration_ms: durationMs,
              rows,
              status: isError ? "error" : "ok",
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

    if (timedOut) {
      throw new CursorAgentError("timeout", "Cursor coach timed out");
    }
    if (exitInfo.code !== 0 && !reply) {
      const auth = /unauthor|forbidden|invalid.*key|401|403/i.test(stderr);
      throw new CursorAgentError(
        auth ? "auth" : "agent",
        auth
          ? "Cursor API key rejected"
          : `cursor-agent exited ${exitInfo.code}: ${stderr.slice(0, 200)}`,
      );
    }

    reply = reply.trim();
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
    await rm(ws, { recursive: true, force: true }).catch(() => {});
  }
}
