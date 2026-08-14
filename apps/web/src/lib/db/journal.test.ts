// @vitest-environment node
//
// Issue #494 — cross-tenant read of the journal table.
//
// `journal` is an optional, externally populated table: this app never writes
// it and it is absent from the production DB. These tests therefore create it
// by hand (as an external producer would), let `openWrite()` lazily ALTER in
// the `user_id` column, and assert that a second user's read cannot reach the
// first user's entries.
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const tmpRoot = mkdtempSync(path.join(tmpdir(), "journal-db-"));

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function newDbFile(): string {
  const file = path.join(tmpRoot, `db-${Math.random().toString(36).slice(2)}.db`);
  new Database(file).close();
  return file;
}

/** Pre-#494 journal table: no user_id column, exactly as an older DB has it. */
function seedLegacyJournal(file: string): void {
  const raw = new Database(file);
  raw.exec(`
    CREATE TABLE journal (
      date TEXT PRIMARY KEY,
      title TEXT,
      content TEXT,
      mood TEXT,
      tags TEXT
    );
    INSERT INTO journal (date, title, content, mood, tags)
    VALUES ('2026-05-01', 'Owner entry', 'private health note', 'good', 'a,b');
  `);
  raw.close();
}

describe("getJournalRange — tenant scoping", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns the caller's rows and never another user's", async () => {
    const file = newDbFile();
    seedLegacyJournal(file);
    process.env.WHOOP_DB_PATH = file;

    const conn = await import("./connection");
    // openWrite() ALTERs in user_id and (single-user DB) backfills to user 1.
    conn.openWrite()?.close();

    const raw = new Database(file);
    raw.prepare("INSERT INTO users (id) VALUES (2)").run();
    raw
      .prepare(
        "INSERT INTO journal (date, title, content, user_id) VALUES (?, ?, ?, ?)",
      )
      .run("2026-05-02", "Second user entry", "their own note", 2);
    raw.close();

    const { getJournalRange } = await import("./journal");

    const u1 = getJournalRange(1, "2026-01-01", "2026-12-31");
    expect(u1.map((r) => r.title)).toEqual(["Owner entry"]);

    const u2 = getJournalRange(2, "2026-01-01", "2026-12-31");
    expect(u2.map((r) => r.title)).toEqual(["Second user entry"]);
    // The load-bearing assertion: user 2's coach cannot read user 1's journal.
    expect(JSON.stringify(u2)).not.toContain("private health note");
  });

  it("a user with no journal rows reads nothing at all", async () => {
    const file = newDbFile();
    seedLegacyJournal(file);
    process.env.WHOOP_DB_PATH = file;

    const conn = await import("./connection");
    conn.openWrite()?.close();

    const raw = new Database(file);
    raw.prepare("INSERT INTO users (id) VALUES (3)").run();
    raw.close();

    const { getJournalRange } = await import("./journal");
    expect(getJournalRange(3, "2026-01-01", "2026-12-31")).toEqual([]);
  });

  it("fails closed when the journal table has not been migrated yet", async () => {
    // A read-only handle can't run the lazy ALTER, so a journal table that
    // still lacks user_id must read as empty rather than as everyone's.
    const file = newDbFile();
    seedLegacyJournal(file);
    process.env.WHOOP_DB_PATH = file;

    const { getJournalRange } = await import("./journal");
    expect(getJournalRange(1, "2026-01-01", "2026-12-31")).toEqual([]);
  });

  it("returns [] when the journal table does not exist", async () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;

    const conn = await import("./connection");
    conn.openWrite()?.close();

    const { getJournalRange } = await import("./journal");
    expect(getJournalRange(1, "2026-01-01", "2026-12-31")).toEqual([]);
  });
});
