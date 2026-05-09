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

describe("findOrCreateUserByEmail tz handling", () => {
  it("persists tz on insert", () => {
    const user = auth.findOrCreateUserByEmail("e@example.com", "Asia/Tokyo");
    expect(user.timezone).toBe("Asia/Tokyo");
    expect(readUserById(user.id)?.timezone).toBe("Asia/Tokyo");
  });

  it("updates tz on a returning user when a new value is supplied", () => {
    const created = auth.findOrCreateUserByEmail("f@example.com", "Asia/Tokyo");
    const updated = auth.findOrCreateUserByEmail("f@example.com", "Asia/Singapore");
    expect(updated.id).toBe(created.id);
    expect(readUserById(created.id)?.timezone).toBe("Asia/Singapore");
  });

  it("preserves existing tz when caller omits the parameter", () => {
    const created = auth.findOrCreateUserByEmail("g@example.com", "Asia/Tokyo");
    auth.findOrCreateUserByEmail("g@example.com");
    expect(readUserById(created.id)?.timezone).toBe("Asia/Tokyo");
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
    // Pre-populate bootstrap with values from CF Access flow (email-only login).
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
