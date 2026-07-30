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
process.env.VAULT_KEY = Buffer.alloc(32, 9).toString("base64");

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
    db.prepare("DELETE FROM chat_message_attachments").run();
    db.prepare("DELETE FROM chat_attachments").run();
    db.prepare("DELETE FROM chat_messages").run();
    db.prepare("DELETE FROM chat_threads").run();
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  coach = await import("./coach");
  // First write goes through openWrite(), which builds the schema lazily.
  coach.createChatThread(1, null);
  resetMessages();
});

beforeEach(() => {
  process.env.VAULT_KEY = Buffer.alloc(32, 9).toString("base64");
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
      { role: "user", contentBlocks: [{ type: "text", text: "first" }], images: [] },
      { role: "assistant", contentBlocks: [{ type: "text", text: "second" }], images: [] },
      { role: "user", contentBlocks: [{ type: "text", text: "third" }], images: [] },
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
    expect(conversation[0]).toEqual({
      role: "assistant",
      contentBlocks: [{ type: "text", text: "follow-up text" }],
      images: [],
    });
    expect(conversation[1]).toEqual({
      role: "user",
      contentBlocks: [{ type: "text", text: "next user turn" }],
      images: [],
    });
  });

  it("caps the returned history at 30 rows and keeps the most recent", () => {
    const threadId = insertThread(1);
    // Insert 35 rows; oldest 5 should be dropped, leaving rows 6..35.
    for (let i = 1; i <= 35; i++) {
      insertMessage(threadId, i % 2 === 0 ? "assistant" : "user", `msg-${i}`);
    }

    const conversation = coach.getChatThreadConversation(1, threadId);

    expect(conversation).toHaveLength(30);
    expect(conversation[0].contentBlocks).toEqual([{ type: "text", text: "msg-6" }]);
    expect(conversation[conversation.length - 1].contentBlocks).toEqual([
      { type: "text", text: "msg-35" },
    ]);
    // Chronological order preserved.
    const contents = conversation.map(
      (message) =>
        (message.contentBlocks[0] as { text: string }).text,
    );
    expect(contents).toEqual(
      Array.from({ length: 30 }, (_, i) => `msg-${i + 6}`),
    );
  });

  it("drops multiple consecutive leading orphan tool_result rows", () => {
    const threadId = insertThread(1);
    // Two parallel tool_results stranded at the head (their tool_use rows fell
    // outside the window), then a normal assistant text turn.
    insertMessage(threadId, "user", "[tool_result]", [
      { type: "tool_result", tool_use_id: "toolu_a", content: "rows..." },
    ]);
    insertMessage(threadId, "user", "[tool_result]", [
      { type: "tool_result", tool_use_id: "toolu_b", content: "rows..." },
    ]);
    insertMessage(threadId, "assistant", "kept");
    insertMessage(threadId, "user", "next");

    const conversation = coach.getChatThreadConversation(1, threadId);

    expect(conversation).toHaveLength(2);
    expect(conversation[0]).toEqual({
      role: "assistant",
      contentBlocks: [{ type: "text", text: "kept" }],
      images: [],
    });
    expect(conversation[1]).toEqual({
      role: "user",
      contentBlocks: [{ type: "text", text: "next" }],
      images: [],
    });
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

    expect(a.map((m) => (m.contentBlocks[0] as { text: string }).text)).toEqual([
      "A1",
      "A2",
    ]);
    expect(b.map((m) => (m.contentBlocks[0] as { text: string }).text)).toEqual([
      "B1",
      "B2",
    ]);
  });
});

describe("chat attachment persistence", () => {
  const attachment = {
    id: "10000000-0000-4000-8000-000000000001",
    mimeType: "image/jpeg" as const,
    width: 320,
    height: 180,
    bytes: Buffer.from("normalized private jpeg"),
    sha256: "a".repeat(64),
  };

  it("atomically stores encrypted bytes and returns attachment metadata", () => {
    const threadId = insertThread(1);
    coach.addChatMessages(threadId, [
      {
        role: "user",
        content: "",
        blocks: [],
        attachments: [attachment],
      },
      {
        role: "assistant",
        content: "I can see it.",
        blocks: [{ type: "text", text: "I can see it." }],
      },
    ]);

    const db = new Database(dbFile);
    const stored = db
      .prepare(
        "SELECT ciphertext, key_version FROM chat_attachments WHERE id = ?",
      )
      .get(attachment.id) as { ciphertext: Buffer; key_version: number };
    const blocks = db
      .prepare(
        "SELECT blocks FROM chat_messages WHERE thread_id = ? AND role = 'user'",
      )
      .get(threadId) as { blocks: string };
    db.close();

    expect(stored.ciphertext.equals(attachment.bytes)).toBe(false);
    expect(stored.key_version).toBe(1);
    expect(blocks.blocks).not.toContain(attachment.bytes.toString("base64"));
    expect(coach.getChatThreadMessages(1, threadId)[0].attachments).toEqual([
      {
        id: attachment.id,
        url: `/api/chat/attachments/${attachment.id}`,
        mime_type: "image/jpeg",
        width: 320,
        height: 180,
        size_bytes: attachment.bytes.length,
      },
    ]);
    expect(
      coach.getChatThreadConversation(1, threadId)[0].images[0].bytes,
    ).toEqual(attachment.bytes);
  });

  it("rolls back the message, attachment, and join when a batch fails", () => {
    const threadId = insertThread(1);

    expect(() =>
      coach.addChatMessages(threadId, [
        {
          role: "user",
          content: "first",
          attachments: [attachment],
        },
        {
          role: "user",
          content: "duplicate",
          attachments: [attachment],
        },
      ]),
    ).toThrow();

    const db = new Database(dbFile);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE thread_id = ?")
          .get(threadId) as { count: number }
      ).count,
    ).toBe(0);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS count FROM chat_attachments WHERE thread_id = ?")
          .get(threadId) as { count: number }
      ).count,
    ).toBe(0);
    db.close();
  });

  it("authorizes by tenant and deletes retained bytes with the thread", () => {
    const db = new Database(dbFile);
    db.prepare("INSERT OR IGNORE INTO users (id, email) VALUES (2, 'other@example.com')").run();
    db.close();
    const threadId = insertThread(1);
    coach.addChatMessages(threadId, [
      { role: "user", content: "photo", attachments: [attachment] },
    ]);

    expect(coach.getChatAttachmentForUser(2, attachment.id)).toBeNull();
    expect(coach.getChatAttachmentForUser(1, attachment.id)?.bytes).toEqual(
      attachment.bytes,
    );
    expect(coach.deleteChatThread(threadId, 1)).toBe(true);
    expect(coach.getChatAttachmentForUser(1, attachment.id)).toBeNull();

    const verify = new Database(dbFile);
    expect(
      (
        verify
          .prepare("SELECT COUNT(*) AS count FROM chat_attachments WHERE id = ?")
          .get(attachment.id) as { count: number }
      ).count,
    ).toBe(0);
    verify.close();
  });

  it("keeps text history available when attachment decryption is unavailable", () => {
    const threadId = insertThread(1);
    coach.addChatMessages(threadId, [
      {
        role: "user",
        content: "Please remember this caption.",
        attachments: [attachment],
      },
    ]);
    delete process.env.VAULT_KEY;

    const conversation = coach.getChatThreadConversation(1, threadId);
    expect(conversation).toHaveLength(1);
    expect(conversation[0].contentBlocks).toEqual([
      { type: "text", text: "Please remember this caption." },
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("image is unavailable"),
      }),
    ]);
    expect(conversation[0].images).toEqual([]);
  });
});

describe("chat message work logs", () => {
  const workLog = {
    version: 1 as const,
    status: "complete" as const,
    duration_ms: 321,
    notes: ["Checking recent recovery."],
    tools: [
      {
        id: "tool-1",
        name: "query_recovery",
        input: { start_date: "2026-07-01" },
        state: "complete" as const,
        status: "ok" as const,
        duration_ms: 44,
        rows: 3,
        response: [{ recovery_score: 72 }],
      },
    ],
  };

  it("round-trips a receipt and leaves old NULL rows unchanged", () => {
    const threadId = insertThread(1);
    insertMessage(threadId, "assistant", "Historical answer", []);
    coach.addChatMessages(threadId, [
      { role: "assistant", content: "New answer", blocks: [], work_log: workLog },
    ]);

    const messages = coach.getChatThreadMessages(1, threadId);

    expect(messages[0].work_log).toBeNull();
    expect(messages[1].work_log).toEqual(workLog);
  });

  it("returns malformed and unsupported receipts as null", () => {
    const threadId = insertThread(1);
    const malformedId = insertMessage(threadId, "assistant", "Malformed", []);
    const unsupportedId = insertMessage(threadId, "assistant", "Unsupported", []);
    const db = new Database(dbFile);
    try {
      db.prepare("UPDATE chat_messages SET work_log = ? WHERE id = ?").run(
        "{bad",
        malformedId,
      );
      db.prepare("UPDATE chat_messages SET work_log = ? WHERE id = ?").run(
        JSON.stringify({ ...workLog, version: 2 }),
        unsupportedId,
      );
    } finally {
      db.close();
    }

    expect(
      coach.getChatThreadMessages(1, threadId).map((message) => message.work_log),
    ).toEqual([null, null]);
  });

  it("never includes work-log data in model conversation history", () => {
    const threadId = insertThread(1);
    coach.addChatMessages(threadId, [
      { role: "assistant", content: "Visible answer", work_log: workLog },
    ]);

    expect(coach.getChatThreadConversation(1, threadId)).toEqual([
      {
        role: "assistant",
        contentBlocks: [{ type: "text", text: "Visible answer" }],
        images: [],
      },
    ]);
  });
});
