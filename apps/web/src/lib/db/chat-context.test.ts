// @vitest-environment node
//
// Issue #608 — chat_threads.context_tokens / context_approximate: lazy
// migration, pre-migration threads, tenant scoping, and clear-on-empty.
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const tmpRoot = mkdtempSync(path.join(tmpdir(), "chat-context-db-"));

type ConnectionModule = typeof import("./connection");
type CoachModule = typeof import("./coach");
let conn: ConnectionModule;
let coach: CoachModule;

beforeAll(async () => {
  process.env.VAULT_KEY = Buffer.alloc(32, 9).toString("base64");
  conn = await import("./connection");
  coach = await import("./coach");
});

afterAll(() => {
  conn.closeConnections();
  rmSync(tmpRoot, { recursive: true, force: true });
});

/**
 * A DB whose chat_threads predates #608: the current schema minus the two
 * context columns, plus one existing thread for user 1 (users 1 and 2 exist).
 */
function legacyDb(): string {
  const file = path.join(tmpRoot, `db-${Math.random().toString(36).slice(2)}.db`);
  new Database(file).close();
  process.env.WHOOP_DB_PATH = file;
  conn.openWrite();
  conn.closeConnections();
  const db = new Database(file);
  db.exec(`
    ALTER TABLE chat_threads DROP COLUMN context_approximate;
    ALTER TABLE chat_threads DROP COLUMN context_tokens;
    INSERT OR IGNORE INTO users (id) VALUES (1), (2);
    INSERT INTO chat_threads (id, user_id, title) VALUES (7, 1, 'Old thread');
  `);
  db.close();
  return file;
}

function threadColumns(file: string): string[] {
  const db = new Database(file, { readonly: true });
  try {
    return (db.prepare("PRAGMA table_info(chat_threads)").all() as { name: string }[]).map(
      (row) => row.name,
    );
  } finally {
    db.close();
  }
}

let file: string;
beforeEach(() => {
  conn.closeConnections();
  file = legacyDb();
  process.env.WHOOP_DB_PATH = file;
});

describe("chat_threads context columns (issue #608)", () => {
  it("the fixture really predates the migration", () => {
    expect(threadColumns(file)).not.toContain("context_tokens");
    expect(threadColumns(file)).not.toContain("context_approximate");
  });

  it("migration adds nullable columns, is idempotent, and leaves old threads with no figure", () => {
    conn.openWrite()?.close();
    conn.closeConnections();
    conn.openWrite()?.close();
    conn.closeConnections();
    conn.openWrite()?.close();

    const cols = threadColumns(file);
    expect(cols.filter((c) => c === "context_tokens")).toHaveLength(1);
    expect(cols.filter((c) => c === "context_approximate")).toHaveLength(1);

    const db = new Database(file, { readonly: true });
    const row = db
      .prepare("SELECT context_tokens, context_approximate FROM chat_threads WHERE id = 7")
      .get() as { context_tokens: number | null; context_approximate: number };
    db.close();
    expect(row).toEqual({ context_tokens: null, context_approximate: 0 });
    // Pre-migration thread: the meter stays hidden.
    expect(coach.getChatThreadContext(1, 7)).toBeNull();
  });

  it("round-trips an exact and an approximate figure", () => {
    coach.setChatThreadContext(1, 7, { tokens: 42_123, approximate: false });
    expect(coach.getChatThreadContext(1, 7)).toEqual({ tokens: 42_123, approximate: false });
    coach.setChatThreadContext(1, 7, { tokens: 9_000, approximate: true });
    expect(coach.getChatThreadContext(1, 7)).toEqual({ tokens: 9_000, approximate: true });
  });

  it("a new thread has no figure until a reply records one", () => {
    const thread = coach.createChatThread(1, null)!;
    expect(coach.getChatThreadContext(1, thread.id)).toBeNull();
  });

  it("is tenant-scoped on read and write", () => {
    coach.setChatThreadContext(1, 7, { tokens: 50_000, approximate: false });
    // Another user cannot read it...
    expect(coach.getChatThreadContext(2, 7)).toBeNull();
    // ...or overwrite it.
    coach.setChatThreadContext(2, 7, { tokens: 1, approximate: true });
    expect(coach.getChatThreadContext(1, 7)).toEqual({ tokens: 50_000, approximate: false });
  });

  it("clearing a thread's messages hides the meter again", () => {
    coach.setChatThreadContext(1, 7, { tokens: 50_000, approximate: false });
    coach.clearChatMessages(7);
    expect(coach.getChatThreadContext(1, 7)).toBeNull();
  });
});
