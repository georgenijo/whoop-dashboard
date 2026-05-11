// @vitest-environment node
import { readdirSync, readFileSync, statSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Run the wrapper against an isolated DB so we can seed and assert isolation.
const tmpRoot = mkdtempSync(path.join(tmpdir(), "scoped-db-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;
new Database(dbFile).close();

type ScopedModule = typeof import("./scoped");
let scoped: ScopedModule;
let conn: typeof import("./connection");

beforeAll(async () => {
  conn = await import("./connection");
  scoped = await import("./scoped");
  // Bootstrap the schema + Phase D migration.
  conn.openWrite()?.close();
});

beforeEach(() => {
  const db = new Database(dbFile);
  try {
    db.prepare("DELETE FROM recovery").run();
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (2)").run();
  } finally {
    db.close();
  }
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function seedRecovery(userId: number, date: string, score: number): void {
  const db = new Database(dbFile);
  try {
    db.prepare(
      "INSERT INTO recovery (user_id, date, recovery_score) VALUES (?, ?, ?)",
    ).run(userId, date, score);
  } finally {
    db.close();
  }
}

describe("forUser wrapper", () => {
  it("all(): binds userId as the trailing param", () => {
    seedRecovery(1, "2025-04-12", 70);
    seedRecovery(2, "2025-04-12", 55);
    const rows = scoped
      .forUser(1)
      .all<{ user_id: number; recovery_score: number }>(
        "SELECT user_id, recovery_score FROM recovery WHERE date = ? AND user_id = ?",
        "2025-04-12",
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(1);
    expect(rows[0].recovery_score).toBe(70);
  });

  it("get(): binds userId as the trailing param", () => {
    seedRecovery(1, "2025-04-12", 70);
    seedRecovery(2, "2025-04-12", 55);
    const row = scoped
      .forUser(2)
      .get<{ user_id: number; recovery_score: number }>(
        "SELECT user_id, recovery_score FROM recovery WHERE date = ? AND user_id = ?",
        "2025-04-12",
      );
    expect(row).toBeDefined();
    expect(row!.user_id).toBe(2);
    expect(row!.recovery_score).toBe(55);
  });

  it("cross-user isolation: querying as user 2 never sees user 1 rows", () => {
    seedRecovery(1, "2025-04-12", 70);
    seedRecovery(2, "2025-04-13", 55);
    const u1 = scoped
      .forUser(1)
      .all<{ user_id: number }>(
        "SELECT user_id FROM recovery WHERE user_id = ?",
      );
    const u2 = scoped
      .forUser(2)
      .all<{ user_id: number }>(
        "SELECT user_id FROM recovery WHERE user_id = ?",
      );
    expect(u1.map((r) => r.user_id)).toEqual([1]);
    expect(u2.map((r) => r.user_id)).toEqual([2]);
  });

  it("dev-mode invariant: missing 'user_id = ?' placeholder throws", () => {
    // NODE_ENV is typed as readonly by the recent @types/node, but the test
    // runner accepts the runtime assignment. Pre-existing tests in the
    // codebase use this same pattern. Cast through to suppress.
    const env = process.env as { NODE_ENV: string | undefined };
    const prev = env.NODE_ENV;
    env.NODE_ENV = "development";
    try {
      expect(() =>
        scoped.forUser(1).all<unknown>("SELECT date FROM recovery"),
      ).toThrow(/missing the trailing 'user_id = \?' placeholder/i);
    } finally {
      env.NODE_ENV = prev;
    }
  });

  it("rejects non-positive userId", () => {
    expect(() => scoped.forUser(0)).toThrow();
    expect(() => scoped.forUser(-1)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CI assertion — every domain SQL must route through the wrapper or one of
// the allowlisted write modules. A stray `FROM recovery` in a new file fails
// the test immediately, before it ships.
// ---------------------------------------------------------------------------

const DOMAIN_TABLES = [
  "recovery",
  "cycles",
  "sleep",
  "workouts",
  "daily_summary",
  "body_measurements",
];

const STATEMENT_RE = new RegExp(
  String.raw`\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+(` +
    DOMAIN_TABLES.join("|") +
    String.raw`)\b`,
  "gi",
);

// The wrapper API requires the caller to write SQL string literals (it
// binds params, doesn't generate SQL). The allowlist therefore covers both:
//   (1) the wrapper + write modules (scoped.ts, connection.ts, upsert.ts,
//       sync.ts) — these are the only files that may execute domain SQL
//       *directly* via db.prepare/db.exec, AND
//   (2) the per-domain read modules — these construct SQL strings as
//       template arguments to forUser(...).all/get(). They're safe by
//       construction (forUser binds user_id as the trailing param).
// The check still catches stray domain SQL anywhere else (page handlers,
// API routes, analytics modules, components, etc.).
const ALLOWLIST_RELATIVE = new Set<string>([
  "src/lib/db/scoped.ts",
  "src/lib/db/connection.ts",
  "src/lib/whoop/upsert.ts",
  "src/lib/sync.ts",
  // Domain read modules — all SQL flows through forUser(...).
  "src/lib/db/recovery.ts",
  "src/lib/db/sleep.ts",
  "src/lib/db/strain.ts",
  "src/lib/db/workouts.ts",
  "src/lib/db/summary.ts",
  "src/lib/db/prs.ts",
  "src/lib/db/body.ts",
]);

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === "dist") {
        continue;
      }
      walk(full, acc);
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      acc.push(full);
    }
  }
  return acc;
}

describe("CI assertion — domain SELECT/JOIN/INTO/UPDATE/DELETE outside the wrapper", () => {
  it("every domain SQL statement lives in scoped.ts / connection.ts / upsert.ts / sync.ts", () => {
    const projectRoot = path.resolve(__dirname, "..", "..", "..");
    const srcRoot = path.join(projectRoot, "src");
    const offenders: { file: string; line: number; match: string }[] = [];
    for (const file of walk(srcRoot)) {
      // Skip test files — they routinely insert / clear domain tables as
      // fixtures, and they don't ship to production.
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      const rel = path.relative(projectRoot, file);
      if (ALLOWLIST_RELATIVE.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      STATEMENT_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = STATEMENT_RE.exec(text)) !== null) {
        // Line number for a helpful error message.
        const line = text.slice(0, match.index).split("\n").length;
        offenders.push({ file: rel, line, match: match[0] });
      }
    }
    if (offenders.length > 0) {
      const lines = offenders.map(
        (o) => `  ${o.file}:${o.line}  →  ${o.match}`,
      );
      throw new Error(
        `Domain SQL found outside the wrapper allowlist:\n${lines.join("\n")}\n\n` +
          `If this is a legitimate write helper, add it to ALLOWLIST_RELATIVE in scoped.test.ts. ` +
          `Otherwise route the query through forUser(userId).all/get(...).`,
      );
    }
  });
});
