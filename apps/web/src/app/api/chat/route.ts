import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { after } from "next/server";
import { createChatThread, getChatThreadById, getChatThreadConversation } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { runAndPersistCoachTurn, titleChatThread } from "@/lib/coach/persistence";

type ChatMessageInput = { role: "user" | "assistant"; content: string };

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
  const body = (await req.json()) as {
    messages: ChatMessageInput[];
    days?: number | null;
    thread_id?: number | string | null;
  };

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

function responseWithThreadId(body: BodyInit | null, threadId: number, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "x-thread-id": String(threadId),
    },
  });
}

export async function POST(req: Request) {
  try {
    const user = await requireAuth(req);
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

    try {
      const reply = await runAndPersistCoachTurn(thread, lastUser, conversation, days);
      if (shouldAutoTitle) {
        after(() => {
          void titleChatThread(thread.id, lastUser);
        });
      }
      return responseWithThreadId(reply, thread.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return responseWithThreadId(`Error: ${msg}`, thread.id, 500);
    }
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
