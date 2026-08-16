// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

const testState = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => void | Promise<void>>,
  thread: { id: 42, title: "existing" } as { id: number; title: string | null },
  conversation: [] as Array<{
    role: "user" | "assistant";
    contentBlocks: unknown[];
    images: [];
  }>,
  provider: "anthropic" as "anthropic" | "cursor",
}));

vi.mock("next/server", () => ({
  after: vi.fn((fn: () => void | Promise<void>) => {
    testState.afterCallbacks.push(fn);
  }),
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({
    user: {
      id: 1,
      email: "test@example.com",
      name: null,
      apple_sub: "test-sub",
      timezone: null,
    },
    source: "ios" as const,
  })),
}));

vi.mock("@/lib/db", () => ({
  createChatThread: vi.fn(() => testState.thread),
  getChatThreadById: vi.fn(() => testState.thread),
  getChatThreadConversation: vi.fn(() => testState.conversation),
  setChatThreadTitle: vi.fn(),
  getUserSettings: vi.fn(() => null),
}));

// Stub the BYOK resolver so the route always sees a usable key in tests.
// (Real resolver reads getUserSettings + process.env.ANTHROPIC_API_KEY.)
vi.mock("@/lib/coach/api-key", () => ({
  resolveApiKeyForUser: vi.fn(() => ({ key: "test-key", origin: "env" })),
  MissingApiKeyError: class MissingApiKeyError extends Error {},
  BadApiKeyError: class BadApiKeyError extends Error {
    constructor(public readonly origin: "user" | "env") {
      super(`Anthropic API key rejected (origin=${origin})`);
    }
  },
}));

vi.mock("@/lib/coach/provider", () => ({
  resolveCoachProvider: vi.fn(() => ({
    provider: testState.provider,
    model: testState.provider === "cursor" ? "composer-2.5" : "claude-sonnet-4-6",
  })),
}));

type RunOpts = {
  onTextDelta?: (text: string) => void;
  onToolUseStart?: (event: { id: string; name: string; input: unknown }) => void;
  onToolUseEnd?: (event: {
    id: string;
    name: string;
    duration_ms: number;
    rows: number | null;
    status: "ok" | "error";
    error?: string;
    response?: unknown;
  }) => void;
  onToolProgress?: (event: { id: string; tool: string; stage: string; message?: string }) => void;
};

const completedWorkLog = {
  version: 1 as const,
  status: "complete" as const,
  duration_ms: 12,
  notes: [],
  tools: [],
};

let runAndPersistImpl: (
  userId: unknown,
  thread: unknown,
  lastUser: unknown,
  conversation: unknown,
  days: unknown,
  source: unknown,
  apiKey: unknown,
  apiKeyOrigin: unknown,
  options: RunOpts,
) => Promise<{ reply: string; workLog: typeof completedWorkLog }> = async () => ({
  reply: "ok",
  workLog: completedWorkLog,
});

vi.mock("@/lib/coach/persistence", () => ({
  runAndPersistCoachTurn: vi.fn(
    (
      userId: unknown,
      thread: unknown,
      lastUser: unknown,
      conversation: unknown,
      days: unknown,
      source: unknown,
      apiKey: unknown,
      apiKeyOrigin: unknown,
      options: RunOpts,
    ) =>
      runAndPersistImpl(
        userId,
        thread,
        lastUser,
        conversation,
        days,
        source,
        apiKey,
        apiKeyOrigin,
        options,
      ),
  ),
  createCoachTurnHandle: vi.fn(() => ({
    accumulator: [],
    markCommitted: () => undefined,
    flushAborted: () => undefined,
  })),
  titleChatThread: vi.fn(async () => undefined),
}));

import { setChatThreadTitle } from "@/lib/db";
import { titleChatThread } from "@/lib/coach/persistence";
import { POST } from "./route";

function makeRequest(body: unknown, query?: string): Request {
  const url = `http://localhost/api/chat${query ? `?${query}` : ""}`;
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function makePng(): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await sharp({
    create: {
      width: 12,
      height: 8,
      channels: 4,
      background: { r: 100, g: 40, b: 200, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  // `new Blob([...])` (a BlobPart[]) wants an ArrayBufferView backed by a
  // plain ArrayBuffer. Node's Buffer.buffer is typed ArrayBufferLike (it
  // may be backed by a SharedArrayBuffer), so it isn't structurally
  // assignable to BlobPart even though it's fine at runtime. Copying into a
  // fresh Uint8Array gives a real ArrayBuffer-backed view — but the return
  // type must be pinned to `Uint8Array<ArrayBuffer>` explicitly, since a
  // bare `Uint8Array` annotation defaults the generic back to
  // `ArrayBufferLike` and reintroduces the same mismatch at call sites.
  return new Uint8Array(buffer);
}

function makeMultipartRequest(
  form: FormData,
  query = "stream=false",
  headers?: HeadersInit,
): Request {
  return new Request(`http://localhost/api/chat?${query}`, {
    method: "POST",
    headers,
    body: form,
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

beforeEach(() => {
  process.env.VAULT_KEY = Buffer.alloc(32, 3).toString("base64");
});

afterEach(() => {
  runAndPersistImpl = async () => ({ reply: "ok", workLog: completedWorkLog });
  testState.afterCallbacks.length = 0;
  testState.thread = { id: 42, title: "existing" };
  testState.conversation = [];
  testState.provider = "anthropic";
  vi.clearAllMocks();
});

describe("POST /api/chat — SSE wiring", () => {
  it("relays stable tool ids, progress, and bounded results to the SSE stream", async () => {
    runAndPersistImpl = async (_uid, _t, _u, _c, _d, _s, _k, _ko, options) => {
      options.onToolUseStart?.({
        id: "sync-1",
        name: "trigger_whoop_sync",
        input: { force: false },
      });
      options.onToolProgress?.({
        id: "sync-1",
        tool: "trigger_whoop_sync",
        stage: "fetching_sleep",
      });
      options.onToolProgress?.({
        id: "sync-1",
        tool: "trigger_whoop_sync",
        stage: "upserting",
        message: "writing rows",
      });
      options.onToolUseEnd?.({
        id: "sync-1",
        name: "trigger_whoop_sync",
        duration_ms: 97,
        rows: 30,
        status: "ok",
        response: { success: true },
      });
      return { reply: "final reply", workLog: completedWorkLog };
    };

    const res = await POST(
      makeRequest({ messages: [{ role: "user", content: "hi" }], thread_id: 42 }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    const text = await readEntireStream(res.body as ReadableStream<Uint8Array>);

    expect(text).toContain(
      'event: tool_use_start\ndata: {"id":"sync-1","name":"trigger_whoop_sync","input":{"force":false}}\n\n',
    );
    expect(text).toContain(
      'event: tool_progress\ndata: {"id":"sync-1","tool":"trigger_whoop_sync","stage":"fetching_sleep"}\n\n',
    );
    expect(text).toContain(
      'event: tool_progress\ndata: {"id":"sync-1","tool":"trigger_whoop_sync","stage":"upserting","message":"writing rows"}\n\n',
    );
    expect(text).toContain(
      'event: tool_use_end\ndata: {"id":"sync-1","name":"trigger_whoop_sync","duration_ms":97,"rows":30,"status":"ok","response":{"success":true}}\n\n',
    );
    expect(text).toContain(
      `event: done\ndata: ${JSON.stringify({ reply: "final reply", work_log: completedWorkLog })}\n\n`,
    );
  });

  it("makes done terminal and refines an immediate deterministic title after the response", async () => {
    testState.thread = { id: 42, title: null };
    runAndPersistImpl = async () => ({
      reply: "final reply",
      workLog: completedWorkLog,
    });

    const res = await POST(
      makeRequest({
        messages: [{ role: "user", content: "  Compare   my recovery\nthis month  " }],
        thread_id: 42,
      }),
    );
    const text = await readEntireStream(res.body as ReadableStream<Uint8Array>);

    expect(setChatThreadTitle).toHaveBeenCalledWith(
      42,
      "Compare my recovery this month",
    );
    expect(text).toBe(
      `: ready\n\nevent: done\ndata: ${JSON.stringify({ reply: "final reply", work_log: completedWorkLog })}\n\n`,
    );
    expect(titleChatThread).not.toHaveBeenCalled();
    expect(testState.afterCallbacks).toHaveLength(1);

    await testState.afterCallbacks[0]();
    expect(titleChatThread).toHaveBeenCalledWith(
      42,
      "  Compare   my recovery\nthis month  ",
      "test-key",
    );
  });

  it("still persists a deterministic title when no Anthropic key is available", async () => {
    testState.thread = { id: 42, title: null };
    testState.provider = "cursor";
    const { resolveApiKeyForUser, MissingApiKeyError } = await import(
      "@/lib/coach/api-key"
    );
    vi.mocked(resolveApiKeyForUser).mockImplementationOnce(() => {
      throw new MissingApiKeyError();
    });

    const res = await POST(
      makeRequest({
        messages: [{ role: "user", content: "How did I sleep?" }],
        thread_id: 42,
      }),
    );
    await readEntireStream(res.body as ReadableStream<Uint8Array>);

    expect(res.status).toBe(200);
    expect(setChatThreadTitle).toHaveBeenCalledWith(42, "How did I sleep?");
    expect(testState.afterCallbacks).toHaveLength(0);
  });

  it("keeps a successful turn terminal when deterministic title persistence fails", async () => {
    testState.thread = { id: 42, title: null };
    vi.mocked(setChatThreadTitle).mockImplementationOnce(() => {
      throw new Error("database unavailable");
    });
    runAndPersistImpl = async () => ({
      reply: "final reply",
      workLog: completedWorkLog,
    });

    const res = await POST(
      makeRequest({
        messages: [{ role: "user", content: "How did I recover?" }],
        thread_id: 42,
      }),
    );
    const text = await readEntireStream(res.body as ReadableStream<Uint8Array>);

    expect(res.status).toBe(200);
    expect(text).toContain(
      `event: done\ndata: ${JSON.stringify({ reply: "final reply", work_log: completedWorkLog })}\n\n`,
    );
    expect(text).not.toContain("event: error");
  });

  it("immediately acknowledges a fast turn without an idle heartbeat", async () => {
    // The initial comment flushes headers immediately; a turn completing under
    // the idle window must not receive the separate watchdog heartbeat.
    runAndPersistImpl = async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { reply: "ok", workLog: completedWorkLog };
    };

    const res = await POST(
      makeRequest({ messages: [{ role: "user", content: "hi" }], thread_id: 42 }),
    );
    const text = await readEntireStream(res.body as ReadableStream<Uint8Array>);

    expect(text.startsWith(": ready\n\n")).toBe(true);
    expect(text).not.toContain(": hb");
  });

  it("emits a heartbeat after the wire goes idle (silence watchdog)", async () => {
    // Provider-agnostic keep-alive: when the turn produces no bytes for the idle
    // window (e.g. Cursor Composer warming its subprocess, or model thinking),
    // the route emits a bare ": hb" comment so Cloudflare / the iOS request
    // timeout can't drop the connection before `done`.
    vi.useFakeTimers();
    try {
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      runAndPersistImpl = async () => {
        await gate;
        return { reply: "ok", workLog: completedWorkLog };
      };

      const res = await POST(
        makeRequest({ messages: [{ role: "user", content: "hi" }], thread_id: 42 }),
      );
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();

      const ready = await reader.read();
      expect(new TextDecoder().decode(ready.value)).toContain(": ready");

      // No real event follows; advance past the idle threshold → watchdog fires.
      await vi.advanceTimersByTimeAsync(9000);

      const { value } = await reader.read();
      expect(new TextDecoder().decode(value)).toContain(": hb");

      release();
      await reader.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns JSON on the ?stream=false path with no SSE bytes (iOS regression guard)", async () => {
    runAndPersistImpl = async () => ({
      reply: "json reply",
      workLog: completedWorkLog,
    });

    const res = await POST(
      makeRequest(
        { messages: [{ role: "user", content: "hi" }], thread_id: 42 },
        "stream=false",
      ),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as {
      thread_id: number;
      reply: string;
      work_log: typeof completedWorkLog;
    };
    expect(body.reply).toBe("json reply");
    expect(body.thread_id).toBe(42);
    expect(body.work_log).toEqual(completedWorkLog);
  });
});

describe("POST /api/chat — multipart images", () => {
  it("keeps JSON text-only requests compatible while passing a provider-neutral turn", async () => {
    let received: unknown;
    runAndPersistImpl = async (_uid, _thread, turn) => {
      received = turn;
      return { reply: "ok", workLog: completedWorkLog };
    };
    const res = await POST(
      makeRequest(
        { messages: [{ role: "user", content: "plain text" }], thread_id: 42 },
        "stream=false",
      ),
    );

    expect(res.status).toBe(200);
    expect(received).toEqual({
      displayText: "plain text",
      modelText: "plain text",
      images: [],
    });
  });

  it("accepts multipart text-only, image-only, and captioned image turns", async () => {
    const turns: Array<{
      displayText: string;
      modelText: string;
      images: Array<{ mimeType: string }>;
    }> = [];
    runAndPersistImpl = async (_uid, _thread, turn) => {
      turns.push(turn as (typeof turns)[number]);
      return { reply: "ok", workLog: completedWorkLog };
    };

    const textOnly = new FormData();
    textOnly.set("message", "multipart text");
    textOnly.set("thread_id", "42");
    expect((await POST(makeMultipartRequest(textOnly))).status).toBe(200);

    const bytes = await makePng();
    const imageOnly = new FormData();
    imageOnly.set("thread_id", "42");
    imageOnly.append("images", new Blob([bytes], { type: "image/png" }), "secret.png");
    expect((await POST(makeMultipartRequest(imageOnly))).status).toBe(200);

    const captioned = new FormData();
    captioned.set("thread_id", "42");
    captioned.set("message", "What is shown?");
    captioned.append("images", new Blob([bytes], { type: "image/png" }), "secret.png");
    expect((await POST(makeMultipartRequest(captioned))).status).toBe(200);

    expect(turns[0]).toMatchObject({ displayText: "multipart text", images: [] });
    expect(turns[1].displayText).toBe("");
    expect(turns[1].modelText).toContain("Analyze the attached image");
    expect(turns[1].images[0].mimeType).toBe("image/jpeg");
    expect(turns[2]).toMatchObject({
      displayText: "What is shown?",
      modelText: "What is shown?",
    });
  });

  it("returns structured count, format, and request-size errors before streaming", async () => {
    const bytes = await makePng();
    const four = new FormData();
    four.set("thread_id", "42");
    for (let index = 0; index < 4; index += 1) {
      four.append("images", new Blob([bytes], { type: "image/png" }), `${index}.png`);
    }
    const tooMany = await POST(makeMultipartRequest(four));
    expect(tooMany.status).toBe(413);
    expect(await tooMany.json()).toMatchObject({ code: "too_many_images" });

    const svg = new FormData();
    svg.set("thread_id", "42");
    svg.append("images", new Blob(["<svg/>"], { type: "image/svg+xml" }), "image.svg");
    const unsupported = await POST(makeMultipartRequest(svg));
    expect(unsupported.status).toBe(415);
    expect(await unsupported.json()).toMatchObject({ code: "unsupported_image" });

    const oversized = new FormData();
    oversized.set("message", "never parsed");
    const requestTooLarge = await POST(
      makeMultipartRequest(oversized, "stream=false", {
        "content-length": String(31 * 1024 * 1024),
      }),
    );
    expect(requestTooLarge.status).toBe(413);
    expect(await requestTooLarge.json()).toMatchObject({
      code: "request_too_large",
    });
  });

  it("fails image storage closed without breaking multipart text-only chat", async () => {
    delete process.env.VAULT_KEY;
    const bytes = await makePng();
    const image = new FormData();
    image.set("thread_id", "42");
    image.append("images", new Blob([bytes], { type: "image/png" }), "image.png");
    const unavailable = await POST(makeMultipartRequest(image));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({
      code: "attachment_storage_unavailable",
    });

    const text = new FormData();
    text.set("thread_id", "42");
    text.set("message", "text still works");
    expect((await POST(makeMultipartRequest(text))).status).toBe(200);
  });
});
