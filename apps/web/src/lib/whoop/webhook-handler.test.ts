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
