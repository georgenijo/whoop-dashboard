import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { after } from "next/server";
import {
  createChatThread,
  getChatThreadById,
  getChatThreadConversation,
  setChatThreadTitle,
} from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import {
  type ApiKeyOrigin,
  MissingApiKeyError,
  resolveApiKeyForUser,
} from "@/lib/coach/api-key";
import {
  createCoachTurnHandle,
  runAndPersistCoachTurn,
  titleChatThread,
} from "@/lib/coach/persistence";
import { resolveCoachProvider } from "@/lib/coach/provider";
import { classifyChatError } from "@/lib/coach/error-mapping";
import { deriveTitleFromText } from "@/lib/coach/title";
import { forModule } from "@/lib/logger";

const chatLog = forModule("api.chat");

// Bare SSE comment line. Ignored by both the web (`readChatStream`) and iOS
// (`ChatService`) parsers, but the bytes keep the streaming connection from
// idling out during silent windows — model thinking (Anthropic OR Cursor
// Composer, which streams via a subprocess and goes quiet during startup +
// thinking) and tool execution. Provider-agnostic because it lives here, above
// the provider dispatch, rather than inside a single provider's loop.
const SSE_HEARTBEAT = new TextEncoder().encode(": hb\n\n");
// Flush response headers and acknowledge the accepted turn immediately. SSE
// clients ignore comment frames, while the web/iOS optimistic "Thinking…"
// state now has a live connection instead of waiting for Cursor's first token.
const SSE_READY = new TextEncoder().encode(": ready\n\n");

// Silence watchdog. If no real SSE bytes have gone out for HEARTBEAT_IDLE_MS,
// emit a heartbeat. Reset by every send, so a chatty stream never sees one —
// this is event-driven on the *absence* of activity, not a blind periodic
// timer. 8s gives wide margin under Cloudflare's ~100s idle window and the iOS
// 130s request timeout.
const HEARTBEAT_IDLE_MS = 8000;
const HEARTBEAT_CHECK_MS = 4000;

type ChatMessageInput = { role: "user" | "assistant"; content: string };
type ChatSseEvent =
  | "tool_use_start"
  | "tool_use_end"
  | "tool_progress"
  | "text_delta"
  | "done"
  | "error";

function parseThreadId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : NaN;
}

async function parseChatRequest(req: Request): Promise<{
  lastUser: string;
  requestedThreadId: number | null;
  days: number | null;
}> {
  let body: {
    messages: ChatMessageInput[];
    days?: number | null;
    thread_id?: number | string | null;
  };
  try {
    body = await req.json();
  } catch {
    throw new Response("Error: request body must be valid JSON", { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new Response("Error: messages must include at least one item", { status: 400 });
  }

  const lastMessage = body.messages[body.messages.length - 1];
  if (
    !lastMessage ||
    lastMessage.role !== "user" ||
    typeof lastMessage.content !== "string" ||
    !lastMessage.content.trim()
  ) {
    throw new Response("Error: last message must be a non-empty user message", { status: 400 });
  }

  const requestedThreadId = parseThreadId(body.thread_id);
  if (Number.isNaN(requestedThreadId as number)) {
    throw new Response("Error: thread_id must be a positive integer", { status: 400 });
  }

  return {
    lastUser: lastMessage.content,
    requestedThreadId,
    days: body.days ?? null,
  };
}

function encodeSse(event: ChatSseEvent, data: unknown): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function wantsStream(req: Request): boolean {
  const value = new URL(req.url).searchParams.get("stream");
  if (value === null) return true;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

function chatStreamResponse(body: BodyInit, threadId: number): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "x-thread-id": String(threadId),
    },
  });
}

function persistDeterministicTitle(threadId: number, firstUserText: string): void {
  try {
    const title = deriveTitleFromText(firstUserText);
    if (title) setChatThreadTitle(threadId, title);
  } catch (error) {
    // The Coach turn is already persisted at this point. Titling is cosmetic
    // and must never turn a successful reply into an API/SSE failure.
    chatLog.warn(
      {
        thread_id: threadId,
        err: error instanceof Error ? error.message : String(error),
      },
      "deterministic_title_failed",
    );
  }
}

function registerTitleRefinement(
  threadId: number,
  firstUserText: string,
  apiKey: string | null,
): () => void {
  if (!apiKey) return () => undefined;

  // Register while the Route Handler still owns the request context. The
  // callback runs only after the response completes; the mutable gate prevents
  // failed turns from receiving an LLM-generated title.
  let enabled = false;
  after(() => {
    if (!enabled) return;
    return titleChatThread(threadId, firstUserText, apiKey);
  });
  return () => {
    enabled = true;
  };
}

export async function POST(req: Request) {
  try {
    const { user, source } = await requireAuth(req);

    // Provider selection drives which key is mandatory. Anthropic (the
    // default) requires its key up front — a missing key is a configuration
    // failure surfaced as 503, which also keeps the chat_threads table free of
    // empty "ghost" threads. The Cursor provider uses the shared
    // CURSOR_API_KEY (already validated inside resolveCoachProvider) and only
    // needs an Anthropic key opportunistically, for auto-titling.
    const selection = resolveCoachProvider(user.id);
    let apiKey: string | null = null;
    let apiKeyOrigin: ApiKeyOrigin = "env";
    try {
      const resolved = resolveApiKeyForUser(user.id);
      apiKey = resolved.key;
      apiKeyOrigin = resolved.origin;
    } catch (err) {
      if (err instanceof MissingApiKeyError) {
        if (selection.provider === "anthropic") {
          return Response.json(
            {
              error:
                "No Anthropic API key configured. Add a personal key in Settings or set ANTHROPIC_API_KEY on the server.",
            },
            { status: 503 },
          );
        }
        // Cursor provider: Anthropic key is optional (used only for auto-title).
      } else {
        throw err;
      }
    }

    const { lastUser, requestedThreadId, days } = await parseChatRequest(req);

    const thread =
      requestedThreadId == null
        ? createChatThread(user.id)
        : getChatThreadById(user.id, requestedThreadId);
    if (!thread) {
      return new Response("Error: thread not found", { status: 404 });
    }

    const conversation = getChatThreadConversation(user.id, thread.id) as MessageParam[];
    const shouldAutoTitle =
      !thread.title?.trim() &&
      !conversation.some((message) => message.role === "assistant");
    conversation.push({ role: "user", content: lastUser });
    const enableTitleRefinement = shouldAutoTitle
      ? registerTitleRefinement(thread.id, lastUser, apiKey)
      : () => undefined;

    if (!wantsStream(req)) {
      try {
        const { reply, workLog } = await runAndPersistCoachTurn(
          user.id,
          thread,
          lastUser,
          conversation,
          days,
          source,
          apiKey ?? "",
          apiKeyOrigin,
          { signal: req.signal },
        );
        if (shouldAutoTitle) {
          persistDeterministicTitle(thread.id, lastUser);
          enableTitleRefinement();
        }
        return Response.json({
          thread_id: thread.id,
          reply,
          work_log: workLog,
        });
      } catch (err) {
        const classified = classifyChatError(err);
        if (classified.kind !== "bad_api_key") {
          chatLog.error(
            {
              thread_id: thread.id,
              user_id: user.id,
              kind: classified.kind,
              err: err instanceof Error ? err.message : String(err),
            },
            "non-stream turn failed",
          );
        }
        const payload: Record<string, unknown> = {
          error: classified.message,
          kind: classified.kind,
        };
        if (classified.origin) payload.origin = classified.origin;
        return Response.json(payload, { status: classified.status });
      }
    }

    const abortController = new AbortController();
    const turnHandle = createCoachTurnHandle(thread.id);
    const relayAbort = () => {
      turnHandle.flushAborted();
      abortController.abort();
    };
    req.signal.addEventListener("abort", relayAbort, { once: true });

    // Hoisted so cancel() (a sibling of start(), not in its scope) can tear the
    // watchdog down too.
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let streamClosed = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let lastActivityMs = Date.now();
        const send = (event: ChatSseEvent, data: unknown) => {
          if (!abortController.signal.aborted && !streamClosed) {
            controller.enqueue(encodeSse(event, data));
            lastActivityMs = Date.now();
          }
        };
        const sendHeartbeat = () => {
          if (!abortController.signal.aborted && !streamClosed) {
            controller.enqueue(SSE_HEARTBEAT);
            lastActivityMs = Date.now();
          }
        };
        const close = () => {
          streamClosed = true;
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          try {
            controller.close();
          } catch {
            // The client may have already closed the connection.
          }
        };

        controller.enqueue(SSE_READY);
        lastActivityMs = Date.now();

        // Silence watchdog: emit a heartbeat only after the wire has been quiet
        // for HEARTBEAT_IDLE_MS. Every send() resets the clock, so an actively
        // streaming turn never triggers it. Covers whichever provider this turn
        // dispatches to (Anthropic SDK loop or the Cursor subprocess loop).
        heartbeatTimer = setInterval(() => {
          if (streamClosed || abortController.signal.aborted) return;
          if (Date.now() - lastActivityMs >= HEARTBEAT_IDLE_MS) sendHeartbeat();
        }, HEARTBEAT_CHECK_MS);

        try {
          const { reply, workLog } = await runAndPersistCoachTurn(
            user.id,
            thread,
            lastUser,
            conversation,
            days,
            source,
            apiKey ?? "",
            apiKeyOrigin,
            {
              signal: abortController.signal,
              onTextDelta: (text) => send("text_delta", { text }),
              onToolUseStart: ({ id, name, input }) =>
                send("tool_use_start", { id, name, input }),
              onToolUseEnd: ({ id, name, duration_ms, rows, status, error, response }) =>
                send("tool_use_end", {
                  id,
                  name,
                  duration_ms,
                  rows,
                  status,
                  ...(error ? { error } : {}),
                  ...(response === undefined ? {} : { response }),
                }),
              onToolProgress: ({ id, tool, stage, message }) =>
                send("tool_progress", {
                  id,
                  tool,
                  stage,
                  ...(message ? { message } : {}),
                }),
            },
            turnHandle
          );

          if (abortController.signal.aborted) {
            close();
            return;
          }

          // Persist a useful title before the terminal event so the client's
          // immediate thread refresh sees it. Optional LLM refinement belongs
          // in Next's post-response lifecycle and must never hold the SSE
          // connection open.
          if (shouldAutoTitle) {
            persistDeterministicTitle(thread.id, lastUser);
            enableTitleRefinement();
          }
          send("done", { reply, work_log: workLog });
          close();
          return;
        } catch (err) {
          if (!abortController.signal.aborted) {
            const classified = classifyChatError(err);
            if (classified.kind !== "bad_api_key") {
              chatLog.error(
                {
                  thread_id: thread.id,
                  user_id: user.id,
                  kind: classified.kind,
                  err: err instanceof Error ? err.message : String(err),
                },
                "stream turn failed",
              );
            }
            try {
              const payload: Record<string, unknown> = {
                kind: classified.kind,
                message: classified.message,
              };
              if (classified.origin) payload.origin = classified.origin;
              send("error", payload);
            } catch {
              // Nothing useful to send once the SSE response is gone.
            }
          }
          close();
        } finally {
          req.signal.removeEventListener("abort", relayAbort);
        }
      },
      cancel() {
        streamClosed = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        turnHandle.flushAborted();
        abortController.abort();
        req.signal.removeEventListener("abort", relayAbort);
      },
    });

    return chatStreamResponse(stream, thread.id);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
