// @vitest-environment node
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));

const tmpRoot = mkdtempSync(path.join(tmpdir(), "webhook-handler-db-"));
const dbFile = path.join(tmpRoot, "test.db");
process.env.WHOOP_DB_PATH = dbFile;
new Database(dbFile).close();

// Mock the whoop client so handleEvent doesn't try to reach api.prod.whoop.com.
const whoopGetMock = vi.fn();
vi.mock("./client", async () => {
  const actual = await vi.importActual<typeof import("./client")>("./client");
  return { ...actual, whoopGet: (...args: unknown[]) => whoopGetMock(...args) };
});

// Stub VAULT_KEY so the integrations.upsertIntegration path encrypts.
// 32 bytes of base64 → 44 chars including padding.
process.env.VAULT_KEY = Buffer.alloc(32, 7).toString("base64");

type WebhookModule = typeof import("./webhook-handler");
let webhook: WebhookModule;
let conn: typeof import("../db/connection");
let integrations: typeof import("../db/integrations");

beforeAll(async () => {
  conn = await import("../db/connection");
  integrations = await import("../db/integrations");
  webhook = await import("./webhook-handler");
  // Trigger schema bootstrap + Phase D migration.
  conn.openWrite()?.close();
});

beforeEach(() => {
  whoopGetMock.mockReset();
  const db = new Database(dbFile);
  try {
    // Reset state between tests.
    db.prepare("DELETE FROM recovery").run();
    db.prepare("DELETE FROM sleep").run();
    db.prepare("DELETE FROM workouts").run();
    db.prepare("DELETE FROM cycles").run();
    db.prepare("DELETE FROM daily_summary").run();
    db.prepare("DELETE FROM integrations").run();
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (1)").run();
    db.prepare("INSERT OR IGNORE INTO users (id) VALUES (42)").run();
  } finally {
    db.close();
  }
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function seedIntegration(
  userId: number,
  providerUserId: string | null,
): void {
  integrations.upsertIntegration({
    user_id: userId,
    provider: "whoop",
    access_token: "a",
    refresh_token: "r",
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  });
  if (providerUserId != null) {
    integrations.setProviderUserId(userId, "whoop", providerUserId);
  }
}

describe("handleEvent — Phase D webhook user mapping", () => {
  it("resolves evt.user_id → local users.id via integrations.provider_user_id and upserts under that user", async () => {
    seedIntegration(42, "9876");
    whoopGetMock.mockResolvedValue({
      id: "w-1",
      start: "2025-04-12T10:00:00.000Z",
      end: "2025-04-12T11:00:00.000Z",
      sport_name: "Running",
      score_state: "SCORED",
      score: {
        average_heart_rate: 130,
        max_heart_rate: 170,
        strain: 8.5,
        kilojoule: 2000,
        distance_meter: 5000,
        zone_durations: {
          zone_zero_milli: 0,
          zone_one_milli: 600000,
          zone_two_milli: 1200000,
          zone_three_milli: 1200000,
          zone_four_milli: 600000,
          zone_five_milli: 0,
        },
      },
    });

    const outcome = await webhook.handleEvent({
      type: "workout.updated",
      id: "w-1",
      user_id: 9876,
    });

    expect(outcome.kind).toBe("handled");

    const db = new Database(dbFile);
    try {
      const row = db
        .prepare("SELECT user_id, id FROM workouts WHERE id = ?")
        .get("w-1") as { user_id: number; id: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.user_id).toBe(42);
    } finally {
      db.close();
    }
  });

  it("returns noop with reason='unknown_whoop_user' when no integrations row matches", async () => {
    // No integration seeded — Whoop sends an event for a user we don't know.
    const outcome = await webhook.handleEvent({
      type: "workout.updated",
      id: "w-1",
      user_id: 9999,
    });

    expect(outcome).toEqual({ kind: "noop", reason: "unknown_whoop_user" });
    // Critically: no API call fires — the noop short-circuits before the
    // upstream fetch.
    expect(whoopGetMock).not.toHaveBeenCalled();
  });

  it("returns noop with reason='missing_whoop_user_id' when the event lacks a user_id", async () => {
    const outcome = await webhook.handleEvent({
      type: "workout.updated",
      id: "w-1",
    });

    expect(outcome).toEqual({ kind: "noop", reason: "missing_whoop_user_id" });
    expect(whoopGetMock).not.toHaveBeenCalled();
  });
});

function sleepUpdatedPayload(id: string, start: string, end: string) {
  return {
    id,
    start,
    end,
    timezone_offset: "+00:00",
    nap: false,
    score_state: "SCORED",
    score: {
      sleep_performance_percentage: 90,
      sleep_efficiency_percentage: 92,
      sleep_consistency_percentage: 80,
      respiratory_rate: 14.5,
      stage_summary: {
        total_in_bed_time_milli: 28_800_000,
        total_light_sleep_time_milli: 14_400_000,
        total_slow_wave_sleep_time_milli: 5_400_000,
        total_rem_sleep_time_milli: 7_200_000,
        total_awake_time_milli: 1_800_000,
        disturbance_count: 3,
        sleep_cycle_count: 5,
      },
      sleep_needed: {
        baseline_milli: 28_800_000,
        need_from_sleep_debt_milli: 0,
        need_from_recent_strain_milli: 0,
        need_from_recent_nap_milli: 0,
      },
    },
  };
}

// Issue #440 review, BLOCK 5: `upsertSleep` computes the new date via
// `sleepSummaryDate` and `INSERT OR REPLACE`s over the same
// `(user_id, sleep_id)` row. If the row already existed under a DIFFERENT
// date (e.g. a legacy row still on its pre-migration start-day date, the
// first time this webhook touches it post-deploy), that vacated date's
// `daily_summary` is now stale and needs its own recompute — not just the
// destination's.
describe("handleEvent — sleep.updated re-dates and recomputes both old and new dates (issue #440)", () => {
  it("recomputes both the vacated (old) date and the destination date when a sleep moves", async () => {
    seedIntegration(1, "1001");
    const db = new Database(dbFile);
    try {
      // Pre-existing row filed on the OLD (pre-migration) date.
      db.prepare(
        "INSERT INTO sleep (user_id, sleep_id, date, in_bed_ms, light_ms, deep_ms, rem_ms, nap) " +
          "VALUES (1, 's-1', '2026-04-28', 28800000, 14400000, 5400000, 7200000, 0)",
      ).run();
      db.prepare(
        "INSERT INTO daily_summary (user_id, date, sleep_hours) VALUES (1, '2026-04-28', 7.5)",
      ).run();
    } finally {
      db.close();
    }

    whoopGetMock.mockResolvedValue(
      sleepUpdatedPayload("s-1", "2026-04-28T23:11:23.000Z", "2026-04-29T08:38:56.000Z"),
    );

    const outcome = await webhook.handleEvent({
      type: "sleep.updated",
      id: "s-1",
      user_id: 1001,
    });

    expect(outcome.kind).toBe("handled");

    const readDb = new Database(dbFile);
    try {
      const row = readDb
        .prepare("SELECT date FROM sleep WHERE sleep_id = 's-1'")
        .get() as { date: string };
      expect(row.date).toBe("2026-04-29");

      // Vacated date: recomputed to NULL, not left stale at 7.5.
      const oldSummary = readDb
        .prepare("SELECT sleep_hours FROM daily_summary WHERE user_id = 1 AND date = '2026-04-28'")
        .get() as { sleep_hours: number | null } | undefined;
      expect(oldSummary?.sleep_hours ?? null).toBeNull();

      // Destination date: recomputed to reflect the row that moved onto it.
      // (light+deep+rem)/3600000 = (14.4M + 5.4M + 7.2M) / 3.6M = 7.5h.
      const newSummary = readDb
        .prepare("SELECT sleep_hours FROM daily_summary WHERE user_id = 1 AND date = '2026-04-29'")
        .get() as { sleep_hours: number } | undefined;
      expect(newSummary?.sleep_hours).toBeCloseTo(7.5, 6);
    } finally {
      readDb.close();
    }
  });

  it("does not attempt an old-date recompute for a brand-new sleep_id", async () => {
    seedIntegration(1, "1001");
    whoopGetMock.mockResolvedValue(
      sleepUpdatedPayload("s-new", "2026-05-01T23:00:00.000Z", "2026-05-02T07:00:00.000Z"),
    );

    const outcome = await webhook.handleEvent({
      type: "sleep.updated",
      id: "s-new",
      user_id: 1001,
    });

    expect(outcome.kind).toBe("handled");
    const db = new Database(dbFile);
    try {
      const row = db
        .prepare("SELECT date FROM sleep WHERE sleep_id = 's-new'")
        .get() as { date: string };
      expect(row.date).toBe("2026-05-02");
    } finally {
      db.close();
    }
  });
});
