import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { after } from "next/server";
import { createChatThread, getChatThreadById, getChatThreadConversation } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { runAndPersistCoachTurn, titleChatThread } from "@/lib/coach/persistence";

type ChatMessageInput = { role: "user" | "assistant"; content: string };
type ChatSseEvent =
  | "tool_use_start"
  | "tool_use_end"
  | "text_delta"
  | "done"
  | "error";

// Cloudflare and most CDN/proxy idle timeouts close SSE streams after 60-100s
// of silence. Long-running tools (e.g. trigger_whoop_sync, 10-30s) leave the
// stream idle long enough for the edge to drop it. A 15s comment-line keepalive
// is well under those thresholds and ignored by EventSource clients.
export const KEEPALIVE_INTERVAL_MS =
  process.env.NODE_ENV === "test" ? 100 : 15_000;
const KEEPALIVE_FRAME = new TextEncoder().encode(`: keepalive\n\n`);

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
      "x-thread-id": String(threadId),
    },
  });
}

export async function POST(req: Request) {
  try {
    const { user, source } = await requireAuth(req);
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

    if (!wantsStream(req)) {
      try {
        const reply = await runAndPersistCoachTurn(thread, lastUser, conversation, days, source, {
          signal: req.signal,
        });
        if (shouldAutoTitle) {
          after(() => {
            void titleChatThread(thread.id, lastUser);
          });
        }
        return Response.json({ thread_id: thread.id, reply });
      } catch (err) {
        console.error("[chat] non-stream turn failed", {
          thread_id: thread.id,
          error: err instanceof Error ? err.message : String(err),
        });
        return Response.json(
          { error: "Coach call failed. Please try again." },
          { status: 500 }
        );
      }
    }

    const abortController = new AbortController();
    const relayAbort = () => abortController.abort();
    req.signal.addEventListener("abort", relayAbort, { once: true });

    let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
    const stopKeepalive = () => {
      if (keepaliveTimer !== null) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: ChatSseEvent, data: unknown) => {
          if (!abortController.signal.aborted) {
            controller.enqueue(encodeSse(event, data));
          }
        };
        const close = () => {
          stopKeepalive();
          try {
            controller.close();
          } catch {
            // The client may have already closed the connection.
          }
        };

        keepaliveTimer = setInterval(() => {
          if (abortController.signal.aborted) {
            stopKeepalive();
            return;
          }
          try {
            controller.enqueue(KEEPALIVE_FRAME);
          } catch {
            stopKeepalive();
          }
        }, KEEPALIVE_INTERVAL_MS);

        try {
          const reply = await runAndPersistCoachTurn(
            thread,
            lastUser,
            conversation,
            days,
            source,
            {
              signal: abortController.signal,
              onTextDelta: (text) => send("text_delta", { text }),
              onToolUseStart: ({ name, input }) => send("tool_use_start", { name, input }),
              onToolUseEnd: ({ name, duration_ms, rows, status, error }) =>
                send("tool_use_end", {
                  name,
                  duration_ms,
                  rows,
                  status,
                  ...(error ? { error } : {}),
                }),
            }
          );

          if (abortController.signal.aborted) {
            close();
            return;
          }

          send("done", { reply });
          if (shouldAutoTitle) {
            after(() => {
              void titleChatThread(thread.id, lastUser);
            });
          }
          close();
        } catch (err) {
          if (!abortController.signal.aborted) {
            const msg = err instanceof Error ? err.message : String(err);
            try {
              send("error", { message: msg });
            } catch {
              // Nothing useful to send once the SSE response is gone.
            }
          }
          close();
        } finally {
          stopKeepalive();
          req.signal.removeEventListener("abort", relayAbort);
        }
      },
      cancel() {
        stopKeepalive();
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
