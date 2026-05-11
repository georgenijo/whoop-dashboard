import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/server", () => ({
  after: (fn: () => void) => fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({
    user: { id: 1, email: "test@example.com" },
    source: "dev",
  })),
}));

vi.mock("@/lib/db", () => ({
  createChatThread: vi.fn(() => ({ id: 42, title: "existing" })),
  getChatThreadById: vi.fn(() => ({ id: 42, title: "existing" })),
  getChatThreadConversation: vi.fn(() => []),
}));

type RunOpts = {
  onTextDelta?: (text: string) => void;
  onToolUseStart?: (event: { name: string; input: unknown }) => void;
  onToolUseEnd?: (event: {
    name: string;
    duration_ms: number;
    rows: number | null;
    status: "ok" | "error";
    error?: string;
  }) => void;
  onToolProgress?: (event: { tool: string; stage: string; message?: string }) => void;
};

let runAndPersistImpl: (
  userId: unknown,
  thread: unknown,
  lastUser: unknown,
  conversation: unknown,
  days: unknown,
  source: unknown,
  options: RunOpts,
) => Promise<string> = async () => "ok";

vi.mock("@/lib/coach/persistence", () => ({
  runAndPersistCoachTurn: vi.fn(
    (
      userId: unknown,
      thread: unknown,
      lastUser: unknown,
      conversation: unknown,
      days: unknown,
      source: unknown,
      options: RunOpts,
    ) =>
      runAndPersistImpl(userId, thread, lastUser, conversation, days, source, options),
  ),
  titleChatThread: vi.fn(async () => undefined),
}));

import { POST } from "./route";

function makeRequest(body: unknown, query?: string): Request {
  const url = `http://localhost/api/chat${query ? `?${query}` : ""}`;
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readEntireStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

afterEach(() => {
  runAndPersistImpl = async () => "ok";
});

describe("POST /api/chat — SSE wiring", () => {
  it("relays tool_progress events from the coach loop to the SSE stream", async () => {
    runAndPersistImpl = async (_uid, _t, _u, _c, _d, _s, options) => {
      options.onToolProgress?.({ tool: "trigger_whoop_sync", stage: "fetching_sleep" });
      options.onToolProgress?.({
        tool: "trigger_whoop_sync",
        stage: "upserting",
        message: "writing rows",
      });
      return "final reply";
    };

    const res = await POST(
      makeRequest({ messages: [{ role: "user", content: "hi" }], thread_id: 42 }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const text = await readEntireStream(res.body as ReadableStream<Uint8Array>);

    expect(text).toContain(
      'event: tool_progress\ndata: {"tool":"trigger_whoop_sync","stage":"fetching_sleep"}\n\n',
    );
    expect(text).toContain(
      'event: tool_progress\ndata: {"tool":"trigger_whoop_sync","stage":"upserting","message":"writing rows"}\n\n',
    );
    expect(text).toMatch(/event: done\ndata: \{"reply":"final reply"\}\n\n/);
  });

  it("emits zero keepalive comment frames (regression guard against bespoke heartbeat)", async () => {
    runAndPersistImpl = async () => {
      await new Promise((r) => setTimeout(r, 250));
      return "ok";
    };

    const res = await POST(
      makeRequest({ messages: [{ role: "user", content: "hi" }], thread_id: 42 }),
    );
    const text = await readEntireStream(res.body as ReadableStream<Uint8Array>);

    expect(text).not.toMatch(/^:\s*keepalive/m);
    // No SSE comment frames at all on the wire — every chunk is a real event.
    for (const chunk of text.split("\n\n")) {
      if (chunk === "") continue;
      expect(chunk.startsWith(":"), `unexpected comment frame: ${chunk}`).toBe(false);
    }
  });

  it("returns JSON on the ?stream=false path with no SSE bytes (iOS regression guard)", async () => {
    runAndPersistImpl = async () => "json reply";

    const res = await POST(
      makeRequest(
        { messages: [{ role: "user", content: "hi" }], thread_id: 42 },
        "stream=false",
      ),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as { thread_id: number; reply: string };
    expect(body.reply).toBe("json reply");
    expect(body.thread_id).toBe(42);
  });
});
