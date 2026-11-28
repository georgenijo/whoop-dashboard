// @vitest-environment node
// Issue #525 — credential_health is lazily bootstrapped by openWrite() and
// round-trips the probe's status row.
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const tmpRoot = mkdtempSync(path.join(tmpdir(), "cred-health-db-"));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

function newDbFile(): string {
  const file = path.join(tmpRoot, `db-${Math.random().toString(36).slice(2)}.db`);
  new Database(file).close();
  return file;
}

describe("credential_health", () => {
  beforeEach(() => vi.resetModules());

  it("returns null before the table exists (read-only path never creates it)", async () => {
    process.env.WHOOP_DB_PATH = newDbFile();
    const mod = await import("./credential-health");
    expect(mod.getCredentialHealth("cursor_shared_key")).toBeNull();
  });

  it("is created by openWrite() and upserts one row per credential", async () => {
    const file = newDbFile();
    process.env.WHOOP_DB_PATH = file;
    const mod = await import("./credential-health");
    const base = {
      credential: "cursor_shared_key",
      status: "ok" as const,
      last_checked: "2026-11-27T12:00:00.000Z",
      last_ok: "2026-11-27T12:00:00.000Z",
      consecutive_invalid: 0,
      incident_open: false,
      detail: "ok",
    };
    mod.saveCredentialHealth(base);
    mod.saveCredentialHealth({
      ...base,
      status: "invalid",
      last_checked: "2026-11-27T12:30:00.000Z",
      consecutive_invalid: 2,
      incident_open: true,
    });
    expect(mod.getCredentialHealth("cursor_shared_key")).toEqual({
      ...base,
      status: "invalid",
      last_checked: "2026-11-27T12:30:00.000Z",
      consecutive_invalid: 2,
      incident_open: true,
    });
    const raw = new Database(file, { readonly: true });
    const cols = (raw.prepare("PRAGMA table_info(credential_health)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    const count = (raw.prepare("SELECT COUNT(*) AS n FROM credential_health").get() as { n: number }).n;
    raw.close();
    expect(cols).toEqual([
      "credential",
      "status",
      "last_checked",
      "last_ok",
      "consecutive_invalid",
      "incident_open",
      "detail",
    ]);
    expect(count).toBe(1);
  });
});
