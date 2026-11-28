// @vitest-environment node
//
// Issue #608 — the context-window figure survives a reload: the thread
// history responses return what the last completed turn recorded, owner-only.
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const authState = vi.hoisted(() => ({ userId: 1 }));
vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({ user: { id: authState.userId }, source: "web" })),
}));

const tmpRoot = mkdtempSync(path.join(tmpdir(), "chat-history-route-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;
process.env.VAULT_KEY = Buffer.alloc(32, 9).toString("base64");
new Database(dbFile).close();

type Db = typeof import("@/lib/db");
let db: Db;
let historyGET: typeof import("./route").GET;
let threadGET: typeof import("../../threads/[id]/route").GET;
let threadId: number;

beforeAll(async () => {
  db = await import("@/lib/db");
  historyGET = (await import("./route")).GET;
  threadGET = (await import("../../threads/[id]/route")).GET;
  const raw = new Database(dbFile);
  db.createChatThread(1, null);
  raw.exec("INSERT OR IGNORE INTO users (id) VALUES (2)");
  raw.close();
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  authState.userId = 1;
  threadId = db.createChatThread(1, "Sleep")!.id;
  db.addChatMessages(threadId, [
    { role: "user", content: "How did I sleep?" },
    { role: "assistant", content: "Well." },
  ]);
});

function history(query: string) {
  return historyGET(new Request(`http://localhost/api/chat/history?${query}`));
}

describe("GET /api/chat/history context (issue #608)", () => {
  it("returns the recorded figure with include=context, so the meter survives a reload", async () => {
    db.setChatThreadContext(1, threadId, { tokens: 42_000, approximate: false });
    const res = await history(`thread_id=${threadId}&include=context`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.context).toEqual({ tokens: 42_000, approximate: false });
    expect(body.messages.map((m: { content: string }) => m.content)).toContain(
      "How did I sleep?",
    );
  });

  it("returns context null — not 0 — for a thread with no recorded figure", async () => {
    const body = await (await history(`thread_id=${threadId}&include=context`)).json();
    expect(body.context).toBeNull();
  });

  it("keeps the bare array body when include=context is absent", async () => {
    db.setChatThreadContext(1, threadId, { tokens: 42_000, approximate: false });
    const body = await (await history(`thread_id=${threadId}`)).json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].content).toBe("How did I sleep?");
  });

  it("never returns another user's figure", async () => {
    db.setChatThreadContext(1, threadId, { tokens: 42_000, approximate: true });
    authState.userId = 2;
    const body = await (await history(`thread_id=${threadId}&include=context`)).json();
    expect(body).toEqual({ messages: [], context: null });
  });
});

describe("GET /api/threads/[id] context (issue #608)", () => {
  const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

  it("includes the figure alongside the thread and messages", async () => {
    db.setChatThreadContext(1, threadId, { tokens: 9_500, approximate: true });
    const res = await threadGET(new Request(`http://localhost/api/threads/${threadId}`), ctx(threadId));
    const body = await res.json();
    expect(body.context).toEqual({ tokens: 9_500, approximate: true });
    expect(body.thread.id).toBe(threadId);
  });

  it("404s for another user's thread", async () => {
    db.setChatThreadContext(1, threadId, { tokens: 9_500, approximate: true });
    authState.userId = 2;
    const res = await threadGET(new Request(`http://localhost/api/threads/${threadId}`), ctx(threadId));
    expect(res.status).toBe(404);
  });
});
