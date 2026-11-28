// @vitest-environment node
//
// Issue #444 — sustained-failure detector evaluated at chat_logs / sync_logs
// write time.
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const sendAlertToToken = vi.fn(async () => ({ ok: true as const, apnsId: "x" }));
vi.mock("@/lib/push", () => ({ sendAlertToToken }));

const logCalls: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
vi.mock("@/lib/logger", () => ({
  forModule: () => ({
    debug: () => {},
    info: (fields: Record<string, unknown>, msg: string) => logCalls.push({ level: "info", fields, msg }),
    warn: (fields: Record<string, unknown>, msg: string) => logCalls.push({ level: "warn", fields, msg }),
    error: (fields: Record<string, unknown>, msg: string) => logCalls.push({ level: "error", fields, msg }),
  }),
}));

const tmpRoot = mkdtempSync(path.join(tmpdir(), "failure-alerts-"));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

const OWNER_SUB = "owner-sub";
const SECRET = "my private prompt about my knee sk-ant-api03-SECRETSECRET";

type Ctx = {
  logs: typeof import("@/lib/db/logs");
  alerts: typeof import("./failure-alerts");
  raw: () => Database.Database;
};

async function bootstrap(mode: string | undefined, opts: { devices?: boolean } = {}): Promise<Ctx> {
  vi.resetModules();
  if (mode === undefined) delete process.env.COACH_FAILURE_ALERTS;
  else process.env.COACH_FAILURE_ALERTS = mode;
  process.env.ADMIN_APPLE_SUB = OWNER_SUB;
  const file = path.join(tmpRoot, `db-${Math.random().toString(36).slice(2)}.db`);
  new Database(file).close();
  process.env.WHOOP_DB_PATH = file;
  const conn = await import("@/lib/db/connection");
  conn.openWrite();
  const raw = new Database(file);
  raw.prepare("INSERT OR IGNORE INTO users (id) VALUES (1)").run();
  raw.prepare("UPDATE users SET apple_sub = ? WHERE id = 1").run(OWNER_SUB);
  raw.prepare("INSERT OR IGNORE INTO users (id) VALUES (2)").run();
  if (opts.devices !== false) {
    const now = new Date().toISOString();
    raw
      .prepare(
        "INSERT INTO device_tokens (user_id, token, platform, env, app_version, created_at, updated_at) VALUES (1, 'tok-1', 'ios', 'production', '1', ?, ?)"
      )
      .run(now, now);
  }
  raw.close();
  return {
    logs: await import("@/lib/db/logs"),
    alerts: await import("./failure-alerts"),
    raw: () => new Database(file, { readonly: true }),
  };
}

function chat(ctx: Ctx, status: "ok" | "error", opts: { userId?: number; message?: string; errorClass?: string } = {}) {
  ctx.logs.addChatLog({
    user_id: opts.userId ?? 1,
    started_at: new Date().toISOString(),
    prompt_preview: SECRET,
    duration_ms: 10,
    status,
    response_length: status === "ok" ? 5 : 0,
    error_message: status === "error" ? (opts.message ?? `Cursor agent auth failed: ${SECRET}`) : null,
    days_context: null,
    type: "api",
    source: "web",
    details: JSON.stringify({
      full_prompt: SECRET,
      ...(status === "error" ? { error_class: opts.errorClass ?? "invalid_key" } : {}),
    }),
    thread_id: null,
  });
}

function sync(ctx: Ctx, startedAt: Date, status: "ok" | "error", opts: { source?: string; message?: string; userId?: number | null } = {}) {
  const full = opts.source !== "keepalive" && opts.source !== "webhook";
  ctx.logs.addSyncLog({
    user_id: opts.userId === undefined ? 1 : opts.userId,
    started_at: startedAt.toISOString(),
    duration_ms: 10,
    status,
    recovery_count: full && status === "ok" ? 1 : null,
    sleep_count: full && status === "ok" ? 1 : null,
    workouts_count: full && status === "ok" ? 1 : null,
    error_message: status === "error" ? (opts.message ?? `Whoop 401 unauthorized ${SECRET}`) : null,
    source: opts.source ?? "manual",
    details: null,
    partial: false,
  });
}

function incident(ctx: Ctx, kind: string, userId = 1) {
  const db = ctx.raw();
  try {
    return db.prepare("SELECT * FROM failure_incidents WHERE user_id = ? AND kind = ?").get(userId, kind) as
      | { status: string; cause: string; delivery: string | null }
      | undefined;
  } finally {
    db.close();
  }
}

function alertLogs() {
  return logCalls.filter((c) => c.msg === "failure alert opened");
}

beforeEach(() => {
  sendAlertToToken.mockClear();
  logCalls.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("flag off", () => {
  it("is a no-op: no incidents, no logs, no APNs", async () => {
    const ctx = await bootstrap(undefined);
    for (let i = 0; i < 25; i++) chat(ctx, "error");
    sync(ctx, new Date(Date.now() - 100 * 3_600_000), "ok");
    sync(ctx, new Date(), "error");
    await ctx.alerts.flushFailureAlertsForTests();
    const db = ctx.raw();
    expect((db.prepare("SELECT COUNT(*) AS n FROM failure_incidents").get() as { n: number }).n).toBe(0);
    db.close();
    expect(alertLogs()).toHaveLength(0);
    expect(sendAlertToToken).not.toHaveBeenCalled();
  });

  it("treats unknown values as off", async () => {
    const ctx = await bootstrap("yes");
    expect(ctx.alerts.failureAlertMode()).toBe("off");
    for (let i = 0; i < 3; i++) chat(ctx, "error");
    expect(incident(ctx, "coach_consecutive")).toBeUndefined();
  });
});

describe("coach_consecutive", () => {
  it("opens on the 3rd consecutive failure and pushes once with the cause", async () => {
    const ctx = await bootstrap("push");
    chat(ctx, "ok");
    chat(ctx, "error");
    chat(ctx, "error");
    expect(incident(ctx, "coach_consecutive")).toBeUndefined();
    chat(ctx, "error");
    await ctx.alerts.flushFailureAlertsForTests();
    expect(incident(ctx, "coach_consecutive")).toMatchObject({ status: "open", cause: "credential_rejected", delivery: "push" });
    expect(sendAlertToToken).toHaveBeenCalledTimes(1);
    expect(sendAlertToToken).toHaveBeenCalledWith("tok-1", expect.objectContaining({
      title: "Coach alert",
      body: "Coach: 3 consecutive failures — provider credential rejected",
    }));
  });

  it("debounces: further failures in the same incident do not push again", async () => {
    const ctx = await bootstrap("push");
    for (let i = 0; i < 8; i++) chat(ctx, "error");
    await ctx.alerts.flushFailureAlertsForTests();
    // consecutive pushed once; error rate needs a full 20-turn window.
    expect(sendAlertToToken).toHaveBeenCalledTimes(1);
  });

  it("re-arms after a success and alerts on the next incident", async () => {
    const ctx = await bootstrap("push");
    for (let i = 0; i < 3; i++) chat(ctx, "error");
    chat(ctx, "ok");
    expect(incident(ctx, "coach_consecutive")?.status).toBe("resolved");
    for (let i = 0; i < 3; i++) chat(ctx, "error", { errorClass: "timeout" });
    await ctx.alerts.flushFailureAlertsForTests();
    expect(sendAlertToToken).toHaveBeenCalledTimes(2);
    expect(sendAlertToToken).toHaveBeenLastCalledWith("tok-1", expect.objectContaining({
      body: "Coach: 3 consecutive failures — provider timed out",
    }));
  });

  it("ignores user-aborted turns", async () => {
    const ctx = await bootstrap("push");
    chat(ctx, "error");
    chat(ctx, "error", { errorClass: "aborted" });
    chat(ctx, "error");
    chat(ctx, "error", { errorClass: "aborted" });
    expect(incident(ctx, "coach_consecutive")).toBeUndefined();
    chat(ctx, "error");
    expect(incident(ctx, "coach_consecutive")?.status).toBe("open");
  });

  it("is per-tenant and labels a non-owner tenant in the owner's push", async () => {
    const ctx = await bootstrap("push");
    chat(ctx, "error", { userId: 2 });
    chat(ctx, "error", { userId: 1 });
    chat(ctx, "error", { userId: 2 });
    chat(ctx, "error", { userId: 1 });
    expect(incident(ctx, "coach_consecutive", 2)).toBeUndefined();
    chat(ctx, "error", { userId: 2 });
    await ctx.alerts.flushFailureAlertsForTests();
    expect(incident(ctx, "coach_consecutive", 2)?.status).toBe("open");
    expect(incident(ctx, "coach_consecutive", 1)).toBeUndefined();
    expect(sendAlertToToken).toHaveBeenCalledWith("tok-1", expect.objectContaining({
      body: "Coach: 3 consecutive failures — provider credential rejected (user 2)",
    }));
  });
});

describe("coach_error_rate", () => {
  // 20-turn window with `errors` failures spread so they are never 3 in a row.
  function spread(ctx: Ctx, errors: number, errorClass = "timeout") {
    const pattern: Array<"ok" | "error"> = Array.from({ length: 20 }, () => "ok");
    for (let i = 0; i < errors; i++) pattern[i * 3] = "error";
    for (const s of pattern) chat(ctx, s, { errorClass });
  }

  it("does not open at exactly 20%", async () => {
    const ctx = await bootstrap("push");
    spread(ctx, 4);
    expect(incident(ctx, "coach_error_rate")).toBeUndefined();
  });

  it("opens above 20% of a full window and pushes once", async () => {
    const ctx = await bootstrap("push");
    spread(ctx, 5);
    await ctx.alerts.flushFailureAlertsForTests();
    expect(incident(ctx, "coach_error_rate")).toMatchObject({ status: "open", cause: "timeout" });
    expect(sendAlertToToken).toHaveBeenCalledTimes(1);
    expect(sendAlertToToken).toHaveBeenCalledWith("tok-1", expect.objectContaining({
      body: "Coach: 5 of last 20 turns failed — mostly provider timed out",
    }));
    // More of the same rot: still the same incident.
    chat(ctx, "error", { errorClass: "timeout" });
    chat(ctx, "ok");
    await ctx.alerts.flushFailureAlertsForTests();
    expect(sendAlertToToken).toHaveBeenCalledTimes(1);
  });

  it("needs a full window before it can open", async () => {
    const ctx = await bootstrap("log");
    for (const s of ["error", "ok", "error", "ok"] as const) chat(ctx, s);
    expect(incident(ctx, "coach_error_rate")).toBeUndefined();
  });

  it("uses hysteresis: stays open until the rate is at or below 10%, then re-arms", async () => {
    const ctx = await bootstrap("push");
    spread(ctx, 5);
    // 20 more successes push the failures out of the window one by one.
    let resolvedAfter = -1;
    for (let i = 0; i < 20; i++) {
      chat(ctx, "ok");
      if (resolvedAfter < 0 && incident(ctx, "coach_error_rate")?.status === "resolved") resolvedAfter = i;
    }
    expect(resolvedAfter).toBeGreaterThan(0);
    spread(ctx, 6);
    await ctx.alerts.flushFailureAlertsForTests();
    expect(incident(ctx, "coach_error_rate")?.status).toBe("open");
    expect(sendAlertToToken).toHaveBeenCalledTimes(2);
  });

  it("does not double-push when the consecutive incident already covers the outage", async () => {
    const ctx = await bootstrap("push");
    for (let i = 0; i < 15; i++) chat(ctx, "ok");
    for (let i = 0; i < 5; i++) chat(ctx, "error");
    await ctx.alerts.flushFailureAlertsForTests();
    expect(incident(ctx, "coach_error_rate")).toMatchObject({ status: "open", delivery: "suppressed" });
    expect(sendAlertToToken).toHaveBeenCalledTimes(1);
  });
});

describe("sync_stale", () => {
  const H = 3_600_000;

  it("opens after 36h without a successful full sync, via the keepalive tick", async () => {
    const ctx = await bootstrap("push");
    // Staleness is judged against the wall clock, so advance a fake one.
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = Date.now();
    sync(ctx, new Date(t0), "ok");
    // Keepalive rows (ok) don't count as a sync, but they drive the check.
    vi.setSystemTime(t0 + 30 * H);
    sync(ctx, new Date(), "ok", { source: "keepalive" });
    expect(incident(ctx, "sync_stale")).toBeUndefined();
    vi.setSystemTime(t0 + 35 * H);
    sync(ctx, new Date(), "error", { message: `refresh rejected or unavailable ${SECRET}` });
    expect(incident(ctx, "sync_stale")).toBeUndefined();
    vi.setSystemTime(t0 + 40 * H);
    sync(ctx, new Date(), "ok", { source: "keepalive" });
    await ctx.alerts.flushFailureAlertsForTests();
    expect(incident(ctx, "sync_stale")?.status).toBe("open");
    expect(sendAlertToToken).toHaveBeenCalledTimes(1);
    expect(sendAlertToToken).toHaveBeenCalledWith("tok-1", expect.objectContaining({
      body: "Sync: no successful sync in 40h — Whoop credential rejected",
    }));
    sync(ctx, new Date(), "ok", { source: "keepalive" });
    await ctx.alerts.flushFailureAlertsForTests();
    expect(sendAlertToToken).toHaveBeenCalledTimes(1);
  });

  it("does not open within 36h", async () => {
    const ctx = await bootstrap("push");
    sync(ctx, new Date(Date.now() - 35 * H), "ok");
    sync(ctx, new Date(), "ok", { source: "keepalive" });
    expect(incident(ctx, "sync_stale")).toBeUndefined();
  });

  it("re-arms when a successful sync lands", async () => {
    const ctx = await bootstrap("push");
    sync(ctx, new Date(Date.now() - 50 * H), "ok");
    sync(ctx, new Date(), "ok", { source: "keepalive" });
    expect(incident(ctx, "sync_stale")?.status).toBe("open");
    sync(ctx, new Date(), "ok");
    expect(incident(ctx, "sync_stale")?.status).toBe("resolved");
  });

  it("measures a never-synced tenant from its first sync activity", async () => {
    const ctx = await bootstrap("log");
    sync(ctx, new Date(Date.now() - 10 * H), "error");
    expect(incident(ctx, "sync_stale")).toBeUndefined();
    sync(ctx, new Date(Date.now() - 40 * H), "error");
    // MIN(started_at) is now 40h ago.
    sync(ctx, new Date(), "error");
    expect(incident(ctx, "sync_stale")?.status).toBe("open");
  });

  it("ignores unattributed rows", async () => {
    const ctx = await bootstrap("push");
    sync(ctx, new Date(Date.now() - 50 * H), "error", { userId: null });
    const db = ctx.raw();
    expect((db.prepare("SELECT COUNT(*) AS n FROM failure_incidents").get() as { n: number }).n).toBe(0);
    db.close();
  });
});

describe("log mode", () => {
  it("tracks and logs incidents but never calls APNs", async () => {
    const ctx = await bootstrap("log");
    for (let i = 0; i < 3; i++) chat(ctx, "error");
    sync(ctx, new Date(Date.now() - 50 * 3_600_000), "ok");
    sync(ctx, new Date(), "ok", { source: "keepalive" });
    await ctx.alerts.flushFailureAlertsForTests();
    expect(incident(ctx, "coach_consecutive")).toMatchObject({ status: "open", delivery: "log" });
    expect(incident(ctx, "sync_stale")).toMatchObject({ status: "open", delivery: "log" });
    expect(alertLogs()).toHaveLength(2);
    expect(alertLogs()[0].level).toBe("warn");
    expect(sendAlertToToken).not.toHaveBeenCalled();
  });
});

describe("push mode delivery edges", () => {
  it("fails closed to no push when the owner is not configured", async () => {
    const ctx = await bootstrap("push");
    delete process.env.ADMIN_APPLE_SUB;
    for (let i = 0; i < 3; i++) chat(ctx, "error");
    await ctx.alerts.flushFailureAlertsForTests();
    expect(incident(ctx, "coach_consecutive")?.delivery).toBe("no_owner");
    expect(sendAlertToToken).not.toHaveBeenCalled();
  });

  it("records no_devices when the owner has no tokens", async () => {
    const ctx = await bootstrap("push", { devices: false });
    for (let i = 0; i < 3; i++) chat(ctx, "error");
    expect(incident(ctx, "coach_consecutive")?.delivery).toBe("no_devices");
    expect(sendAlertToToken).not.toHaveBeenCalled();
  });

  it("a throwing APNs sender never breaks the log write", async () => {
    const ctx = await bootstrap("push");
    sendAlertToToken.mockRejectedValueOnce(new Error("APNS_KEY_ID missing"));
    for (let i = 0; i < 3; i++) chat(ctx, "error");
    await ctx.alerts.flushFailureAlertsForTests();
    const db = ctx.raw();
    expect((db.prepare("SELECT COUNT(*) AS n FROM chat_logs").get() as { n: number }).n).toBe(3);
    db.close();
  });
});

describe("payload sanitisation", () => {
  it("never puts raw error text, prompts, or keys into a push or log line", async () => {
    const ctx = await bootstrap("push");
    for (let i = 0; i < 3; i++) chat(ctx, "error", { errorClass: "something-new", message: `boom ${SECRET}` });
    sync(ctx, new Date(Date.now() - 50 * 3_600_000), "ok");
    sync(ctx, new Date(), "error", { message: `weird ${SECRET}` });
    await ctx.alerts.flushFailureAlertsForTests();
    const pushed = JSON.stringify(sendAlertToToken.mock.calls);
    const logged = JSON.stringify(logCalls);
    for (const out of [pushed, logged]) {
      expect(out).not.toContain("sk-ant");
      expect(out).not.toContain("knee");
      expect(out).not.toContain("boom");
      expect(out).not.toContain("weird");
    }
    expect(sendAlertToToken).toHaveBeenCalledWith("tok-1", expect.objectContaining({
      body: "Coach: 3 consecutive failures — unclassified error",
    }));
  });

  it("classifies legacy rows without error_class from the message, with a closed label set", async () => {
    const { classifyChatFailure, classifySyncFailure, causeLabel } = await import("./failure-alerts");
    expect(classifyChatFailure("Cursor coach timed out", null)).toBe("timeout");
    expect(classifyChatFailure("401 invalid x-api-key", null)).toBe("credential_rejected");
    expect(classifyChatFailure("Your credit balance is too low", null)).toBe("quota");
    expect(classifyChatFailure("This operation was aborted", null)).toBe("aborted");
    expect(classifyChatFailure(`anything ${SECRET}`, "not json")).toBe("unclassified");
    expect(classifySyncFailure("Whoop 429 too many requests")).toBe("whoop_rate_limited");
    expect(classifySyncFailure("fetch failed")).toBe("network");
    expect(causeLabel("unclassified")).toBe("unclassified error");
  });
});
