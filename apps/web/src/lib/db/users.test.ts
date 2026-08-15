import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// WHOOP_DB_PATH must be set before importing the module under test —
// connection.ts reads it via dbPath() which lazy-creates the schema on first
// openWrite(). Mirrors the pattern in coach.test.ts.
const tmpRoot = mkdtempSync(path.join(tmpdir(), "users-db-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;

// better-sqlite3 needs the file to exist (fileMustExist: true). Touch it.
new Database(dbFile).close();

type AuthModule = typeof import("./auth");
type ConnectionModule = typeof import("./connection");
let auth: AuthModule;
let connection: ConnectionModule;

function listUserColumns(): string[] {
  const db = new Database(dbFile);
  try {
    const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
    return cols.map((c) => c.name);
  } finally {
    db.close();
  }
}

function readUserById(id: number): { id: number; timezone: string | null } | null {
  const db = new Database(dbFile);
  try {
    const row = db
      .prepare("SELECT id, timezone FROM users WHERE id = ? LIMIT 1")
      .get(id) as { id: number; timezone: string | null } | undefined;
    return row ?? null;
  } finally {
    db.close();
  }
}

// Mutates the bootstrap row (id=1) globally — safe because tmpRoot gives this
// suite its own SQLite file; nothing else in the project shares the DB path.
function resetUsers(): void {
  const db = new Database(dbFile);
  try {
    // Wipe everything except the bootstrap row (id=1) which openWrite() always
    // re-inserts via INSERT OR IGNORE, then null its tz so each test starts
    // from a clean slate.
    db.prepare("DELETE FROM users WHERE id <> 1").run();
    db.prepare("UPDATE users SET timezone = NULL, apple_sub = NULL, email = NULL WHERE id = 1").run();
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  connection = await import("./connection");
  auth = await import("./auth");
  // First write triggers schema creation + the lazy ALTER for `timezone`.
  const db = connection.openWrite();
  db?.close();
});

beforeEach(() => {
  resetUsers();
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("users.timezone migration", () => {
  it("adds the timezone column on first openWrite()", () => {
    expect(listUserColumns()).toContain("timezone");
  });

  it("is idempotent across repeated openWrite() calls", () => {
    // Calling openWrite() again must not throw (the ALTER would error if it
    // re-ran). The PRAGMA-gated check guarantees a no-op on the second pass.
    const a = connection.openWrite();
    a?.close();
    const b = connection.openWrite();
    b?.close();
    const cols = listUserColumns();
    expect(cols.filter((c) => c === "timezone")).toHaveLength(1);
  });
});

describe("upsertUserByAppleSub tz handling", () => {
  it("persists tz on insert", () => {
    const user = auth.upsertUserByAppleSub("apple-sub-1", "a@example.com", "America/New_York");
    expect(user.timezone).toBe("America/New_York");
    expect(readUserById(user.id)?.timezone).toBe("America/New_York");
  });

  it("updates tz on existing user when caller supplies a new value", () => {
    const created = auth.upsertUserByAppleSub("apple-sub-2", "b@example.com", "America/Los_Angeles");
    const updated = auth.upsertUserByAppleSub("apple-sub-2", "b@example.com", "Europe/London");
    expect(updated.id).toBe(created.id);
    expect(updated.timezone).toBe("Europe/London");
    expect(readUserById(created.id)?.timezone).toBe("Europe/London");
  });

  it("does NOT clobber an existing tz when caller passes null/undefined", () => {
    const created = auth.upsertUserByAppleSub("apple-sub-3", "c@example.com", "America/Chicago");
    auth.upsertUserByAppleSub("apple-sub-3", "c@example.com", null);
    expect(readUserById(created.id)?.timezone).toBe("America/Chicago");
    auth.upsertUserByAppleSub("apple-sub-3", "c@example.com");
    expect(readUserById(created.id)?.timezone).toBe("America/Chicago");
  });

  it("inserts NULL timezone when no tz is passed", () => {
    const user = auth.upsertUserByAppleSub("apple-sub-4", "d@example.com");
    expect(user.timezone ?? null).toBeNull();
    expect(readUserById(user.id)?.timezone).toBeNull();
  });
});

describe("upsertUserByAppleSub branch coverage (issue #262)", () => {
  // The three-branch contract from the issue:
  //   1. row with this apple_sub exists  → return it
  //   2. user_id=1 exists with apple_sub IS NULL → bind it (preserve data)
  //   3. else → fresh insert
  //
  // The existing test fixture already nulls out user_id=1 in resetUsers, so
  // each test starts in a state where the bootstrap row is unbound.

  it("branch 1 — returns the existing user when apple_sub already matches", async () => {
    // First call binds user_id=1 (branch 2). Second call hits branch 1.
    const first = auth.upsertUserByAppleSub("apple-sub-existing", "first@example.com");
    const second = auth.upsertUserByAppleSub("apple-sub-existing");
    expect(second.id).toBe(first.id);
    expect(second.apple_sub).toBe("apple-sub-existing");
    expect(second.email).toBe("first@example.com");
  });

  it("branch 2 — binds the unbound bootstrap user_id=1 instead of creating a new row", async () => {
    const user = auth.upsertUserByAppleSub("apple-sub-bootstrap", "boot@example.com", "America/New_York");
    expect(user.id).toBe(1);
    expect(user.apple_sub).toBe("apple-sub-bootstrap");
    expect(user.email).toBe("boot@example.com");
    expect(user.timezone).toBe("America/New_York");
    // Persisted to disk, not just in the returned object.
    const db = new Database(dbFile);
    try {
      const row = db
        .prepare("SELECT id, apple_sub, email FROM users WHERE id = 1")
        .get() as { id: number; apple_sub: string; email: string };
      expect(row.apple_sub).toBe("apple-sub-bootstrap");
      expect(row.email).toBe("boot@example.com");
    } finally {
      db.close();
    }
  });

  it("branch 3 — creates a fresh user when bootstrap is already bound to someone else", async () => {
    // First sign-in binds id=1 to alice.
    const alice = auth.upsertUserByAppleSub("apple-sub-alice", "alice@example.com");
    expect(alice.id).toBe(1);
    // Second sign-in is bob — fresh insert (bootstrap is now taken).
    const bob = auth.upsertUserByAppleSub("apple-sub-bob", "bob@example.com");
    expect(bob.id).not.toBe(1);
    expect(bob.apple_sub).toBe("apple-sub-bob");
    expect(bob.email).toBe("bob@example.com");
  });

  it("branch 2 — does not clobber bootstrap email/tz when those are already populated", async () => {
    // Pre-populate bootstrap with email + tz (legacy single-user state pre-SIWA).
    const db = new Database(dbFile);
    try {
      db.prepare(
        "UPDATE users SET email = ?, timezone = ?, apple_sub = NULL WHERE id = 1"
      ).run("preset@example.com", "Europe/London");
    } finally {
      db.close();
    }
    const user = auth.upsertUserByAppleSub("apple-sub-bind", "different@example.com", "America/Chicago");
    expect(user.id).toBe(1);
    expect(user.apple_sub).toBe("apple-sub-bind");
    // COALESCE(email, ?) keeps preset value; same for timezone.
    expect(user.email).toBe("preset@example.com");
    expect(user.timezone).toBe("Europe/London");
  });
});

// Issue #494 regression. Adding `user_id INTEGER REFERENCES users(id)` to
// chat_logs / sync_logs put those tables under FK enforcement, but they were
// missing from USER_FK_TABLES. mergeUserInto repointed only the listed tables
// and then ran DELETE FROM users, which failed the FK check on a
// foreign_keys=ON connection — surfacing as a 500 from the SIWA callback, i.e.
// a hard sign-in lockout for any account that had ever chatted or synced.
describe("split-brain merge repoints the issue #494 log tables", () => {
  function seedSplitBrain(): { keepId: number; goneId: number } {
    const db = new Database(dbFile);
    try {
      db.prepare("DELETE FROM chat_logs").run();
      db.prepare("DELETE FROM sync_logs").run();
      // Surviving row: matched by apple_sub, holds the OLD email.
      db.prepare(
        "UPDATE users SET apple_sub = ?, email = ? WHERE id = 1",
      ).run("sub-keep", "old@example.com");
      // Doomed row: matched by the NEW email the user now signs in with.
      const gone = db
        .prepare("INSERT INTO users (apple_sub, email) VALUES (?, ?)")
        .run("sub-gone", "new@example.com");
      const goneId = Number(gone.lastInsertRowid);
      db.prepare(
        "INSERT INTO chat_logs (user_id, started_at, prompt_preview, duration_ms, status, response_length) VALUES (?, ?, ?, 1, 'ok', 1)",
      ).run(goneId, "2026-06-01T00:00:00Z", "history worth keeping");
      db.prepare(
        "INSERT INTO sync_logs (user_id, started_at, duration_ms, status, source) VALUES (?, ?, 1, 'ok', 'manual')",
      ).run(goneId, "2026-06-01T00:00:00Z");
      return { keepId: 1, goneId };
    } finally {
      db.close();
    }
  }

  it("merges without an FK failure and repoints log rows instead of orphaning them", () => {
    const { keepId, goneId } = seedSplitBrain();

    // Pre-#494-fix this threw `FOREIGN KEY constraint failed`.
    const user = auth.upsertUserByAppleSub("sub-keep", "new@example.com");
    expect(user.id).toBe(keepId);

    const db = new Database(dbFile);
    try {
      expect(
        db.prepare("SELECT id FROM users WHERE id = ?").get(goneId),
      ).toBeUndefined();

      // Repointed, not orphaned: the history follows the surviving account.
      const chat = db
        .prepare("SELECT user_id FROM chat_logs WHERE prompt_preview = ?")
        .get("history worth keeping") as { user_id: number };
      expect(chat.user_id).toBe(keepId);
      const sync = db
        .prepare("SELECT user_id FROM sync_logs WHERE source = 'manual'")
        .get() as { user_id: number };
      expect(sync.user_id).toBe(keepId);

      // Nothing left pointing at the deleted account.
      for (const table of ["chat_logs", "sync_logs"]) {
        const dangling = db
          .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`)
          .get(goneId) as { n: number };
        expect(dangling.n, `${table} dangling`).toBe(0);
      }
    } finally {
      db.close();
    }
  });

  it("the merged-in sync history becomes the survivor's cooldown signal", () => {
    // Consequence check: repointing (rather than orphaning) means the moved
    // sync_logs row is now visible to the surviving user's cooldown gate.
    const { keepId } = seedSplitBrain();
    auth.upsertUserByAppleSub("sub-keep", "new@example.com");

    const db = new Database(dbFile);
    try {
      const row = db
        .prepare(
          "SELECT started_at FROM sync_logs WHERE status = 'ok' AND user_id = ? ORDER BY id DESC LIMIT 1",
        )
        .get(keepId) as { started_at: string } | undefined;
      expect(row?.started_at).toBe("2026-06-01T00:00:00Z");
    } finally {
      db.close();
    }
  });
});

// Issue #502 review. chat_attachments.user_id is declared
// `REFERENCES users(id) ON DELETE CASCADE`. Before the #502 fix,
// chat_attachments was absent from USER_FK_TABLES — but unlike
// chat_logs/sync_logs pre-#494 (which had NO ON DELETE action and made the
// trailing `DELETE FROM users` throw), the CASCADE satisfied the FK check by
// silently deleting the attachment row instead of throwing. That's not a
// sign-in 500 — it's quieter and worse: the losing account's attachments
// just vanish instead of following their thread to the surviving account.
// Moving chat_attachments into USER_FK_TABLES makes it repoint like every
// other log/history table instead of cascading away.
describe("split-brain merge repoints chat_attachments instead of cascading (issue #502)", () => {
  it("attachment survives the merge, repointed to the survivor", () => {
    let goneId: number;
    const seed = new Database(dbFile);
    try {
      seed.prepare("DELETE FROM chat_attachments").run();
      seed.prepare("DELETE FROM chat_threads").run();
      // Surviving row: matched by apple_sub, holds the OLD email.
      seed
        .prepare("UPDATE users SET apple_sub = ?, email = ? WHERE id = 1")
        .run("sub-keep-attach", "old-attach@example.com");
      // Doomed row: matched by the NEW email the user now signs in with.
      const gone = seed
        .prepare("INSERT INTO users (apple_sub, email) VALUES (?, ?)")
        .run("sub-gone-attach", "new-attach@example.com");
      goneId = Number(gone.lastInsertRowid);
      const thread = seed
        .prepare("INSERT INTO chat_threads (user_id, title) VALUES (?, ?)")
        .run(goneId, "gone user's thread");
      const threadId = Number(thread.lastInsertRowid);
      seed
        .prepare(
          `INSERT INTO chat_attachments
             (id, thread_id, user_id, mime_type, width, height, size_bytes, sha256, ciphertext, key_version, created_at)
           VALUES (?, ?, ?, 'image/png', 10, 10, 100, 'deadbeef', ?, 1, '2026-06-01T00:00:00Z')`,
        )
        .run("att-1", threadId, goneId, Buffer.from("ciphertext"));
    } finally {
      seed.close();
    }

    // Pre-#502-fix this call would still succeed (no FK throw — CASCADE
    // handled it), but silently deleted the attachment row along the way.
    const keep = auth.upsertUserByAppleSub("sub-keep-attach", "new-attach@example.com");
    expect(keep.id).toBe(1);

    const db = new Database(dbFile);
    try {
      const row = db
        .prepare("SELECT user_id FROM chat_attachments WHERE id = 'att-1'")
        .get() as { user_id: number } | undefined;
      // The concrete win from issue #502: the row survives at all (pre-fix it
      // was cascaded away), and it's repointed to the surviving account
      // rather than left dangling on the deleted one.
      expect(row).toBeDefined();
      expect(row!.user_id).toBe(keep.id);
    } finally {
      db.close();
    }
  });
});

describe("DB helper trusts caller (no validation at this layer)", () => {
  // Validation is enforced at the route layer (see apple/route.test.ts). The DB
  // helper trusts whatever it's handed — exercised here only to confirm we
  // don't crash on a junk string and that subsequent corrections still work.
  it("does not corrupt the row when given an unusual string", () => {
    const user = auth.upsertUserByAppleSub("apple-sub-junk", null, "not-a-real-tz");
    expect(readUserById(user.id)?.timezone).toBe("not-a-real-tz");
    const fixed = auth.upsertUserByAppleSub("apple-sub-junk", null, "America/New_York");
    expect(fixed.id).toBe(user.id);
    expect(readUserById(user.id)?.timezone).toBe("America/New_York");
  });
});
