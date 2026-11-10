// @vitest-environment node
//
// Issue #589 — one schema bootstrap per process, long-lived connections, and
// pure reads that never touch SQLite's write lock.
import { mkdtempSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const tmpRoot = mkdtempSync(path.join(tmpdir(), "conn-pool-"));
let counter = 0;
function newDbFile(): string {
  const file = path.join(tmpRoot, `pool-${++counter}.db`);
  // An empty file is a valid, never-migrated SQLite DB.
  writeFileSync(file, "");
  return file;
}

type Conn = typeof import("./connection");
let conn: Conn;

beforeEach(async () => {
  process.env.WHOOP_DB_PATH = newDbFile();
  conn = await import("./connection");
  conn.closeConnections();
});

afterEach(() => {
  conn.closeConnections();
  vi.restoreAllMocks();
});

afterAll(() => {
  conn?.closeConnections();
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** Number of times the schema bootstrap's first statement has run. */
function spyOnBootstrap(): () => number {
  const exec = Database.prototype.exec;
  const spy = vi.spyOn(Database.prototype, "exec").mockImplementation(function (
    this: InstanceType<typeof Database>,
    sql: string,
  ) {
    return exec.call(this, sql);
  });
  return () =>
    spy.mock.calls.filter((c) => String(c[0]).includes("CREATE TABLE IF NOT EXISTS recovery"))
      .length;
}

describe("schema bootstrap runs once per DB file", () => {
  it("runs the migration a single time across many openWrite() calls", () => {
    const bootstraps = spyOnBootstrap();
    for (let i = 0; i < 50; i++) {
      const db = conn.openWrite();
      expect(db).not.toBeNull();
      db?.close();
    }
    expect(bootstraps()).toBe(1);
  });

  it("does not re-run when reads and cached statements are interleaved", () => {
    const bootstraps = spyOnBootstrap();
    conn.openWrite()?.close();
    for (let i = 0; i < 10; i++) {
      conn.safeReadQuery((db) => db.prepare("SELECT 1").get());
      conn.safeQuery((db) => db.prepare("SELECT 1").get());
      conn.openRead()?.close();
    }
    expect(bootstraps()).toBe(1);
  });

  it("re-runs for a different DB path, then once more for each file only", () => {
    const bootstraps = spyOnBootstrap();
    const first = process.env.WHOOP_DB_PATH as string;
    const second = newDbFile();

    conn.openWrite()?.close();
    expect(bootstraps()).toBe(1);

    process.env.WHOOP_DB_PATH = second;
    conn.openWrite()?.close();
    conn.openWrite()?.close();
    expect(bootstraps()).toBe(2);

    // Going back to the first file re-opens it, but its schema is already
    // current on disk; the bootstrap is idempotent so a re-run is harmless —
    // what matters is that it is bounded by file switches, not by call count.
    process.env.WHOOP_DB_PATH = first;
    for (let i = 0; i < 20; i++) conn.openWrite()?.close();
    expect(bootstraps()).toBeLessThanOrEqual(3);
  });

  it("re-runs when the file at the same path is deleted and recreated", () => {
    const bootstraps = spyOnBootstrap();
    const file = process.env.WHOOP_DB_PATH as string;
    conn.openWrite()?.close();
    expect(bootstraps()).toBe(1);

    conn.openWrite()?.close();
    expect(bootstraps()).toBe(1);

    unlinkSync(file);
    for (const ext of ["-wal", "-shm"]) {
      try {
        unlinkSync(file + ext);
      } catch {
        /* sidecar already gone */
      }
    }
    writeFileSync(file, "");
    const db = conn.openWrite();
    expect(db).not.toBeNull();
    expect(bootstraps()).toBe(2);
    // The new file really got the schema (not the deleted file's handle).
    expect(conn.hasTable(db as import("better-sqlite3").Database, "users")).toBe(true);
  });

  it("returns null (and no stale handle) once the DB file is gone", () => {
    const file = process.env.WHOOP_DB_PATH as string;
    expect(conn.openWrite()).not.toBeNull();
    unlinkSync(file);
    for (const ext of ["-wal", "-shm"]) {
      try {
        unlinkSync(file + ext);
      } catch {
        /* sidecar already gone */
      }
    }
    expect(conn.openWrite()).toBeNull();
    expect(conn.open()).toBeNull();
    expect(conn.openRead()).toBeNull();
  });

  it("a failed bootstrap is retried on the next call instead of being latched", () => {
    const file = process.env.WHOOP_DB_PATH as string;
    // Deterministic failure: make the first bootstrap exec throw once.
    const exec = Database.prototype.exec;
    let failed = false;
    vi.spyOn(Database.prototype, "exec").mockImplementation(function (
      this: InstanceType<typeof Database>,
      sql: string,
    ) {
      if (!failed && String(sql).includes("CREATE TABLE IF NOT EXISTS recovery")) {
        failed = true;
        throw new Error("injected bootstrap failure");
      }
      return exec.call(this, sql);
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(conn.openWrite()).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    const retry = conn.openWrite();
    expect(retry).not.toBeNull();
    expect(conn.hasTable(retry as import("better-sqlite3").Database, "users")).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(0);
  });
});

describe("connection reuse", () => {
  it("hands back the same read-write and read-only handle on every call", () => {
    const w1 = conn.openWrite();
    const w2 = conn.openWrite();
    const r1 = conn.open();
    const r2 = conn.openRead();
    expect(w1).not.toBeNull();
    expect(w1).toBe(w2);
    expect(r1).not.toBeNull();
    expect(r1).toBe(r2);
    expect(r1).not.toBe(w1);
  });

  it("keeps the same two connections open across many calls and their close()s", () => {
    const w0 = conn.openWrite();
    const r0 = conn.open();
    for (let i = 0; i < 25; i++) {
      conn.openWrite()?.close();
      conn.open()?.close();
      conn.safeReadQuery((db) => db.prepare("SELECT 1").get());
      conn.safeWriteQuery((db) => db.prepare("SELECT 1").get());
    }
    expect(conn.openWrite()).toBe(w0);
    expect(conn.open()).toBe(r0);
    expect(w0?.open).toBe(true);
    expect(r0?.open).toBe(true);
    expect(r0?.readonly).toBe(true);
    expect(w0?.readonly).toBe(false);
  });

  it("close() on a shared handle is a no-op so legacy finally-blocks stay safe", () => {
    const w = conn.openWrite();
    w?.close();
    expect(w?.open).toBe(true);
    expect(() => w?.prepare("SELECT 1").get()).not.toThrow();
    const r = conn.open();
    r?.close();
    expect(r?.open).toBe(true);
  });

  it("closeConnections() really closes both handles and the next call reopens", () => {
    const w = conn.openWrite();
    const r = conn.open();
    conn.closeConnections();
    expect(w?.open).toBe(false);
    expect(r?.open).toBe(false);
    const w2 = conn.openWrite();
    expect(w2).not.toBeNull();
    expect(w2).not.toBe(w);
    expect(w2?.open).toBe(true);
  });

  it("switching WHOOP_DB_PATH closes the previous file's handles (no leak)", () => {
    const w = conn.openWrite();
    const r = conn.open();
    process.env.WHOOP_DB_PATH = newDbFile();
    const w2 = conn.openWrite();
    expect(w2).not.toBe(w);
    expect(w?.open).toBe(false);
    expect(r?.open).toBe(false);
    expect(w2?.name).toBe(process.env.WHOOP_DB_PATH);
  });

  it("sets busy_timeout 5000 and WAL on the shared handles", () => {
    expect(conn.BUSY_TIMEOUT_MS).toBe(5000);
    const w = conn.openWrite();
    const r = conn.open();
    expect(w?.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(r?.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(w?.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(r?.pragma("journal_mode", { simple: true })).toBe("wal");
  });

  it("prepareCached returns the same statement for the same SQL on one handle", () => {
    const r = conn.open() as import("better-sqlite3").Database;
    const a = conn.prepareCached(r, "SELECT 1 AS x");
    const b = conn.prepareCached(r, "SELECT 1 AS x");
    expect(a).toBe(b);
    expect(a.get()).toEqual({ x: 1 });
    expect(conn.prepareCached(r, "SELECT 2 AS x")).not.toBe(a);
  });

  it("a nested openWrite() inside a transaction joins it instead of hitting SQLITE_BUSY", () => {
    const db = conn.openWrite() as import("better-sqlite3").Database;
    db.exec("CREATE TABLE IF NOT EXISTS nest_probe (v INTEGER)");
    const run = db.transaction(() => {
      db.prepare("INSERT INTO nest_probe (v) VALUES (1)").run();
      const inner = conn.openWrite() as import("better-sqlite3").Database;
      expect(inner).toBe(db);
      inner.prepare("INSERT INTO nest_probe (v) VALUES (2)").run();
    });
    run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM nest_probe").get()).toEqual({ n: 2 });
  });
});

describe("pure reads do not take the write lock", () => {
  /** Seed enough rows for every read function under test. */
  async function seed(): Promise<{ token: string; threadId: number }> {
    const auth = await import("./auth");
    const coach = await import("./coach");
    const settings = await import("./user_settings");
    const w = conn.openWrite() as import("better-sqlite3").Database;
    // The bootstrap creates a sole user (id=1) on a fresh DB; fill it in.
    w.prepare("UPDATE users SET email = 'a@b.c', name = 'A', apple_sub = 'sub-1' WHERE id = 1").run();
    const { token } = auth.createSession(1);
    settings.markOnboarded(1);
    const thread = coach.createChatThread(1, "hello");
    expect(thread).not.toBeNull();
    coach.addChatMessages(thread!.id, [
      { role: "user", content: "hi" },
      // blocks must be non-NULL: the visibility clause is NULL-hostile.
      { role: "assistant", content: "hey", blocks: [{ type: "text", text: "hey" }] },
    ]);
    return { token, threadId: thread!.id };
  }

  it("test control: a second writer really is blocked while BEGIN IMMEDIATE is held", async () => {
    await seed();
    const holder = new Database(process.env.WHOOP_DB_PATH as string);
    try {
      holder.exec("BEGIN IMMEDIATE");
      const probe = new Database(process.env.WHOOP_DB_PATH as string, { timeout: 0 });
      try {
        expect(() => probe.exec("BEGIN IMMEDIATE")).toThrow(/SQLITE_BUSY|database is locked/i);
      } finally {
        probe.close();
      }
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }
  });

  it("getUserById / getSessionByToken / getUserSettings / coach reads succeed while another connection holds BEGIN IMMEDIATE", async () => {
    const { token, threadId } = await seed();
    const auth = await import("./auth");
    const coach = await import("./coach");
    const settings = await import("./user_settings");

    // Warm: one-time bootstrap + both handles are open before the lock is taken.
    expect(auth.getUserById(1)).not.toBeNull();

    const holder = new Database(process.env.WHOOP_DB_PATH as string);
    try {
      holder.exec("BEGIN IMMEDIATE");
      // The write lock is genuinely held (see the control test above).
      const probe = new Database(process.env.WHOOP_DB_PATH as string, { timeout: 0 });
      try {
        expect(() => probe.exec("BEGIN IMMEDIATE")).toThrow(/SQLITE_BUSY|database is locked/i);
      } finally {
        probe.close();
      }

      const t0 = performance.now();
      const user = auth.getUserById(1);
      const session = auth.getSessionByToken(token);
      const userSettings = settings.getUserSettings(1);
      const threads = coach.getChatThreads(1);
      const latest = coach.getLatestChatThread(1);
      const byId = coach.getChatThreadById(1, threadId);
      const summary = coach.getChatThreadSummary(1, threadId);
      const messages = coach.getChatThreadMessages(1, threadId);
      const conversation = coach.getChatThreadConversation(1, threadId);
      const elapsed = performance.now() - t0;

      expect(user?.email).toBe("a@b.c");
      expect(session?.user_id).toBe(1);
      expect(userSettings?.user_id).toBe(1);
      expect(threads.map((t) => t.id)).toEqual([threadId]);
      expect(latest?.id).toBe(threadId);
      expect(byId?.title).toBe("hello");
      expect(summary?.id).toBe(threadId);
      expect(messages.map((m) => m.content)).toEqual(["hi", "hey"]);
      expect(conversation).toHaveLength(2);
      // A write-handle read would wait out the 5000 ms busy timeout (or fail);
      // the read-only connection answers immediately.
      expect(elapsed).toBeLessThan(1000);
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }
  });

  it("the read functions never run their query on the read-write handle", async () => {
    const { token, threadId } = await seed();
    const auth = await import("./auth");
    const coach = await import("./coach");
    const settings = await import("./user_settings");
    const w = conn.openWrite() as import("better-sqlite3").Database;
    const prepareOnWrite = vi.spyOn(w, "prepare");

    auth.getUserById(1);
    auth.getSessionByToken(token);
    auth.getUserByAppleSub("sub-1");
    auth.getUserByEmail("a@b.c");
    settings.getUserSettings(1);
    coach.getChatThreads(1);
    coach.getLatestChatThread(1);
    coach.getChatThreadById(1, threadId);
    coach.getChatThreadSummary(1, threadId);
    coach.getChatThreadMessages(1, threadId);
    coach.getChatThreadConversation(1, threadId);

    expect(prepareOnWrite).not.toHaveBeenCalled();
  });

  it("a read-only handle cannot write, so a read path can never mutate", () => {
    const r = conn.openRead() as import("better-sqlite3").Database;
    expect(r.readonly).toBe(true);
    expect(() => r.exec("CREATE TABLE should_fail (x INTEGER)")).toThrow(/readonly/i);
  });

  it("reads see writes committed through the write handle straight away", async () => {
    const auth = await import("./auth");
    const w = conn.openWrite() as import("better-sqlite3").Database;
    expect(auth.getUserById(7)).toBeNull();
    w.prepare("INSERT INTO users (id, email) VALUES (7, 'seven@x.y')").run();
    expect(auth.getUserById(7)?.email).toBe("seven@x.y");
  });

  it("reads on a DB that openWrite() has never touched trigger the one-time bootstrap rather than failing", async () => {
    const bootstraps = spyOnBootstrap();
    const auth = await import("./auth");
    expect(auth.getUserById(999)).toBeNull();
    expect(bootstraps()).toBe(1);
    // The bootstrap's sole user is visible to the read-only handle.
    expect(auth.getUserById(1)?.id).toBe(1);
    const raw = new Database(process.env.WHOOP_DB_PATH as string, { readonly: true });
    try {
      expect(conn.hasTable(raw, "users")).toBe(true);
      expect(conn.hasTable(raw, "chat_threads")).toBe(true);
    } finally {
      raw.close();
    }
  });
});
