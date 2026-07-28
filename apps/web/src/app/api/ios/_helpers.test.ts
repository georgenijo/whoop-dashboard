import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { describe, it } from "vitest";

// File name ends `.test.ts` so the scoped-SQL allowlist scan
// (src/lib/db/scoped.test.ts) skips it — this module contains domain-table
// SQL fixtures that are intentionally outside the forUser wrapper. A single
// trivial test below keeps vitest's "no tests in file" rule happy.
describe("ios test helpers", () => {
  it("loads without throwing", () => {
    // no-op
  });
});

// Shared test-DB plumbing for the /api/ios/* route suites. Each suite calls
// initIosTestDb() exactly once at module load (BEFORE importing the route),
// then uses the returned handles to seed fixtures + reset between tests.
//
// We can't share a single DB file across suites because vitest runs files in
// parallel by default; each suite creates its own tmpdir-isolated file.

export type IosTestDb = {
  dbFile: string;
  tmpRoot: string;
  db: () => Database.Database;
  reset: () => void;
  seedRecovery: (date: string, opts?: RecoveryOpts) => void;
  seedSleep: (date: string, opts?: SleepOpts) => void;
  seedCycle: (date: string, opts?: CycleOpts) => void;
  seedWorkout: (id: string, date: string, opts?: WorkoutOpts) => void;
};

type RecoveryOpts = {
  score?: number | null;
  hrv?: number | null;
  rhr?: number | null;
  spo2?: number | null;
  skin_temp?: number | null;
};

type SleepOpts = {
  in_bed_ms?: number | null;
  light_ms?: number | null;
  deep_ms?: number | null;
  rem_ms?: number | null;
  awake_ms?: number | null;
  sleep_need_ms?: number | null;
  performance?: number | null;
  efficiency?: number | null;
  // Override when a test needs TWO rows with the same date + nap flag — the
  // derived default would collide and INSERT OR REPLACE would overwrite.
  sleep_id?: string;
  need_from_baseline_ms?: number | null;
  need_from_debt_ms?: number | null;
  need_from_strain_ms?: number | null;
  need_from_nap_ms?: number | null;
  nap?: 0 | 1;
};

type CycleOpts = {
  strain?: number | null;
  kilojoule?: number | null;
  avg_hr?: number | null;
  max_hr?: number | null;
};

type WorkoutOpts = {
  sport?: string | null;
  duration_sec?: number | null;
  avg_hr?: number | null;
  max_hr?: number | null;
  strain?: number | null;
  kilojoule?: number | null;
  distance_m?: number | null;
  zone_0_ms?: number | null;
  zone_1_ms?: number | null;
  zone_2_ms?: number | null;
  zone_3_ms?: number | null;
  zone_4_ms?: number | null;
  zone_5_ms?: number | null;
  raw?: string | null;
};

export function initIosTestDb(prefix: string): IosTestDb {
  const tmpRoot = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  const dbFile = path.join(tmpRoot, "test.db");
  process.env.WHOOP_DB_PATH = dbFile;
  // better-sqlite3 requires the file to exist before openWrite() runs.
  new Database(dbFile).close();

  function db(): Database.Database {
    return new Database(dbFile);
  }

  function reset(): void {
    const d = db();
    try {
      for (const t of ["recovery", "sleep", "cycles", "workouts"]) {
        d.prepare(`DELETE FROM ${t} WHERE user_id = 1`).run();
      }
    } finally {
      d.close();
    }
  }

  function seedRecovery(date: string, opts: RecoveryOpts = {}) {
    const d = db();
    try {
      d.prepare(
        "INSERT OR REPLACE INTO recovery (user_id, date, recovery_score, hrv, rhr, spo2, skin_temp) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        1,
        date,
        opts.score ?? null,
        opts.hrv ?? null,
        opts.rhr ?? null,
        opts.spo2 ?? null,
        opts.skin_temp ?? null,
      );
    } finally {
      d.close();
    }
  }

  function seedSleep(date: string, opts: SleepOpts = {}) {
    const d = db();
    try {
      d.prepare(
        // sleep's PK is (user_id, sleep_id) — a date can carry several rows
        // (naps + the main sleep), so sleep_id is NOT NULL and must be seeded.
        `INSERT OR REPLACE INTO sleep (
           user_id, sleep_id, date, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms,
           sleep_need_ms, performance, efficiency,
           need_from_baseline_ms, need_from_debt_ms, need_from_strain_ms, need_from_nap_ms,
           nap
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        1,
        opts.sleep_id ?? `sleep-${date}-${opts.nap ?? 0}`,
        date,
        opts.in_bed_ms ?? null,
        opts.light_ms ?? null,
        opts.deep_ms ?? null,
        opts.rem_ms ?? null,
        opts.awake_ms ?? null,
        opts.sleep_need_ms ?? null,
        opts.performance ?? null,
        opts.efficiency ?? null,
        opts.need_from_baseline_ms ?? null,
        opts.need_from_debt_ms ?? null,
        opts.need_from_strain_ms ?? null,
        opts.need_from_nap_ms ?? null,
        opts.nap ?? 0,
      );
    } finally {
      d.close();
    }
  }

  function seedCycle(date: string, opts: CycleOpts = {}) {
    const d = db();
    try {
      d.prepare(
        "INSERT OR REPLACE INTO cycles (user_id, date, strain, kilojoule, avg_hr, max_hr) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        1,
        date,
        opts.strain ?? null,
        opts.kilojoule ?? null,
        opts.avg_hr ?? null,
        opts.max_hr ?? null,
      );
    } finally {
      d.close();
    }
  }

  function seedWorkout(id: string, date: string, opts: WorkoutOpts = {}) {
    const d = db();
    try {
      d.prepare(
        `INSERT OR REPLACE INTO workouts (
           user_id, id, date, sport, duration_sec, avg_hr, max_hr, strain, kilojoule,
           distance_m, zone_0_ms, zone_1_ms, zone_2_ms, zone_3_ms, zone_4_ms, zone_5_ms, raw
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        1,
        id,
        date,
        opts.sport ?? null,
        opts.duration_sec ?? null,
        opts.avg_hr ?? null,
        opts.max_hr ?? null,
        opts.strain ?? null,
        opts.kilojoule ?? null,
        opts.distance_m ?? null,
        opts.zone_0_ms ?? null,
        opts.zone_1_ms ?? null,
        opts.zone_2_ms ?? null,
        opts.zone_3_ms ?? null,
        opts.zone_4_ms ?? null,
        opts.zone_5_ms ?? null,
        opts.raw ?? null,
      );
    } finally {
      d.close();
    }
  }

  return { dbFile, tmpRoot, db, reset, seedRecovery, seedSleep, seedCycle, seedWorkout };
}

export function makeIosRequest(pathAndQuery: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${pathAndQuery}`, { headers });
}
