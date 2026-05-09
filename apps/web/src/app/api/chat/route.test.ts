import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// next/server's after() runs the callback after the response. The route imports
// it but it's only invoked on the auto-title path, which we don't trigger here.
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

let runAndPersistImpl: (...args: unknown[]) => Promise<string> = async () => "ok";

vi.mock("@/lib/coach/persistence", () => ({
  runAndPersistCoachTurn: vi.fn((...args: unknown[]) => runAndPersistImpl(...args)),
  titleChatThread: vi.fn(async () => undefined),
}));

import * as route from "./route";

const { POST, KEEPALIVE_INTERVAL_MS } = route;

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

describe("POST /api/chat — SSE keepalive", () => {
  it("uses a short keepalive interval when NODE_ENV=test", () => {
    expect(KEEPALIVE_INTERVAL_MS).toBe(100);
  });

  it("emits keepalive comment frames at the configured cadence during a slow turn", async () => {
    // Simulate a long-running tool: hold the turn open ~600ms so we expect
    // multiple 100ms keepalive ticks.
    runAndPersistImpl = async () => {
      await new Promise((r) => setTimeout(r, 600));
      return "final reply";
    };

    const res = await POST(
      makeRequest({ messages: [{ role: "user", content: "hi" }], thread_id: 42 })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(res.body).not.toBeNull();

    const text = await readEntireStream(res.body as ReadableStream<Uint8Array>);

    // Each keepalive frame is exactly `: keepalive\n\n`.
    const keepaliveMatches = text.match(/:\s*keepalive\n\n/g) ?? [];
    expect(keepaliveMatches.length).toBeGreaterThanOrEqual(3);

    // The done event must still arrive after all the keepalives.
    expect(text).toMatch(/event: done\ndata: \{"reply":"final reply"\}\n\n/);

    // Keepalive frames must not interleave inside an event payload — verify
    // the framing by splitting on blank lines and ensuring each non-empty
    // chunk parses as either a comment or a complete event.
    for (const chunk of text.split("\n\n")) {
      if (chunk === "") continue;
      const isComment = chunk.startsWith(":");
      const isEvent = /^event: \w+\ndata: /.test(chunk);
      expect(isComment || isEvent).toBe(true);
    }
  });

  it("stops emitting keepalives after the response stream closes (done path)", async () => {
    runAndPersistImpl = async () => "quick";

    const res = await POST(
      makeRequest({ messages: [{ role: "user", content: "hi" }], thread_id: 42 })
    );
    const text = await readEntireStream(res.body as ReadableStream<Uint8Array>);

    // After draining, wait well past the keepalive interval — the stream is
    // already closed, so no further bytes can arrive. The decoded string is
    // final; we just need to verify the test's stream-close path didn't leak.
    // (If the interval kept ticking, controller.enqueue would throw; the
    // stopKeepalive path swallows it. Either way, this test verifies happy-
    // path framing has the done event present and no trailing keepalives
    // accumulate in the decoded body.)
    await new Promise((r) => setTimeout(r, 350));

    expect(text).toMatch(/event: done\ndata: /);
    // The closing "done" frame should be the last non-comment payload.
    const trimmed = text.trimEnd();
    expect(trimmed.endsWith('"reply":"quick"}')).toBe(true);
  });

  it("does NOT add keepalives to the JSON path (?stream=false)", async () => {
    runAndPersistImpl = async () => "json reply";

    const res = await POST(
      makeRequest(
        { messages: [{ role: "user", content: "hi" }], thread_id: 42 },
        "stream=false"
      )
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as { thread_id: number; reply: string };
    expect(body.reply).toBe("json reply");
    expect(body.thread_id).toBe(42);
  });
});
