import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// WHOOP_DB_PATH must be set before importing the module under test — connection.ts
// reads it via dbPath() which lazy-creates the schema on first openWrite().
const tmpRoot = mkdtempSync(path.join(tmpdir(), "coach-db-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;

// better-sqlite3 needs the file to exist (fileMustExist: true). Touch it.
new Database(dbFile).close();

type CoachModule = typeof import("./coach");
let coach: CoachModule;

function insertThread(userId: number): number {
  const db = new Database(dbFile);
  try {
    const result = db
      .prepare("INSERT INTO chat_threads (user_id, title) VALUES (?, ?)")
      .run(userId, null);
    return Number(result.lastInsertRowid);
  } finally {
    db.close();
  }
}

function insertMessage(
  threadId: number,
  role: "user" | "assistant",
  content: string,
  blocks: unknown = null,
): number {
  const db = new Database(dbFile);
  try {
    const result = db
      .prepare(
        "INSERT INTO chat_messages (thread_id, role, content, blocks, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        threadId,
        role,
        content,
        blocks === null ? null : JSON.stringify(blocks),
        new Date().toISOString(),
      );
    return Number(result.lastInsertRowid);
  } finally {
    db.close();
  }
}

function resetMessages(): void {
  const db = new Database(dbFile);
  try {
    db.prepare("DELETE FROM chat_messages").run();
    db.prepare("DELETE FROM chat_threads").run();
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  // Importing here triggers openWrite() once via the first DB call below, which
  // builds the schema lazily.
  coach = await import("./coach");
  // Force schema bootstrap by running any write through openWrite().
  coach.createChatThread(1, null);
  resetMessages();
});

beforeEach(() => {
  resetMessages();
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("getChatThreadConversation", () => {
  it("returns plain-text rows in chronological order when there are no tool blocks", () => {
    const threadId = insertThread(1);
    insertMessage(threadId, "user", "first");
    insertMessage(threadId, "assistant", "second");
    insertMessage(threadId, "user", "third");

    const conversation = coach.getChatThreadConversation(1, threadId);

    expect(conversation).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
    ]);
  });

  it("drops a leading orphan tool_result that the cap stranded", () => {
    const threadId = insertThread(1);
    // Simulate a row layout where the LIMIT has already sliced off the matching
    // tool_use: the first row in the window is a user tool_result.
    insertMessage(threadId, "user", "[tool_result]", [
      { type: "tool_result", tool_use_id: "toolu_orphan", content: "rows..." },
    ]);
    insertMessage(threadId, "assistant", "follow-up text");
    insertMessage(threadId, "user", "next user turn");

    const conversation = coach.getChatThreadConversation(1, threadId);

    expect(conversation).toHaveLength(2);
    expect(conversation[0]).toEqual({ role: "assistant", content: "follow-up text" });
    expect(conversation[1]).toEqual({ role: "user", content: "next user turn" });
  });

  it("scopes results to the requested thread", () => {
    const threadA = insertThread(1);
    const threadB = insertThread(1);
    insertMessage(threadA, "user", "A1");
    insertMessage(threadB, "user", "B1");
    insertMessage(threadA, "assistant", "A2");
    insertMessage(threadB, "assistant", "B2");

    const a = coach.getChatThreadConversation(1, threadA);
    const b = coach.getChatThreadConversation(1, threadB);

    expect(a.map((m) => m.content)).toEqual(["A1", "A2"]);
    expect(b.map((m) => m.content)).toEqual(["B1", "B2"]);
  });
});
