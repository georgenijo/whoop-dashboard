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

describe("invalid tz inputs", () => {
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
