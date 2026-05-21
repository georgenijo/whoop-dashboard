import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { after } from "next/server";
import { createChatThread, getChatThreadById, getChatThreadConversation } from "@/lib/db";
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
import { classifyChatError } from "@/lib/coach/error-mapping";
import { forModule } from "@/lib/logger";

const chatLog = forModule("api.chat");

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
      "x-thread-id": String(threadId),
    },
  });
}

export async function POST(req: Request) {
  try {
    const { user, source } = await requireAuth(req);

    // Resolve the Anthropic API key BEFORE parsing the request body or
    // creating a thread — a missing key is a configuration failure, not a
    // chat error, and surfacing it as a 503 keeps the chat_threads table
    // free of empty "ghost" threads created right before a 503.
    let apiKey: string;
    let apiKeyOrigin: ApiKeyOrigin;
    try {
      const resolved = resolveApiKeyForUser(user.id);
      apiKey = resolved.key;
      apiKeyOrigin = resolved.origin;
    } catch (err) {
      if (err instanceof MissingApiKeyError) {
        return Response.json(
          {
            error:
              "No Anthropic API key configured. Add a personal key in Settings or set ANTHROPIC_API_KEY on the server.",
          },
          { status: 503 },
        );
      }
      throw err;
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

    if (!wantsStream(req)) {
      try {
        const reply = await runAndPersistCoachTurn(
          user.id,
          thread,
          lastUser,
          conversation,
          days,
          source,
          apiKey,
          apiKeyOrigin,
          { signal: req.signal },
        );
        if (shouldAutoTitle) {
          after(() => {
            void titleChatThread(thread.id, lastUser, apiKey);
          });
        }
        return Response.json({ thread_id: thread.id, reply });
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

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: ChatSseEvent, data: unknown) => {
          if (!abortController.signal.aborted) {
            controller.enqueue(encodeSse(event, data));
          }
        };
        const close = () => {
          try {
            controller.close();
          } catch {
            // The client may have already closed the connection.
          }
        };

        try {
          const reply = await runAndPersistCoachTurn(
            user.id,
            thread,
            lastUser,
            conversation,
            days,
            source,
            apiKey,
            apiKeyOrigin,
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
              onToolProgress: ({ tool, stage, message }) =>
                send("tool_progress", {
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

          send("done", { reply });
          if (shouldAutoTitle) {
            after(() => {
              void titleChatThread(thread.id, lastUser, apiKey);
            });
          }
          close();
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
