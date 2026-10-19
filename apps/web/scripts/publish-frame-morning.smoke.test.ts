// @vitest-environment node
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const tmpRoot = mkdtempSync(path.join(tmpdir(), "frame-morning-cli-smoke-"));
const appRoot = path.resolve(__dirname, "..");
const received: unknown[] = [];
let server: Server;
let webhookUrl: string;

function requestedDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function createSyntheticDb(file: string): void {
  const now = new Date();
  const date = requestedDate(now);
  const iso = now.toISOString();
  const db = new Database(file);
  try {
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, apple_sub TEXT, email TEXT, timezone TEXT);
      CREATE TABLE integrations (user_id INTEGER, provider TEXT, needs_reauth INTEGER, provider_user_id TEXT, updated_at TEXT, PRIMARY KEY (user_id, provider));
      CREATE TABLE recovery (user_id INTEGER, date TEXT, recovery_score REAL, hrv REAL, rhr REAL, raw JSON, PRIMARY KEY (user_id, date));
      CREATE TABLE sleep (user_id INTEGER, sleep_id TEXT, date TEXT, in_bed_ms INTEGER, light_ms INTEGER, deep_ms INTEGER, rem_ms INTEGER, performance REAL, nap INTEGER, raw JSON, PRIMARY KEY (user_id, sleep_id));
      CREATE TABLE cycles (user_id INTEGER, date TEXT, strain REAL, raw JSON, PRIMARY KEY (user_id, date));
      CREATE TABLE daily_steps (user_id INTEGER, date TEXT, steps INTEGER, source TEXT, updated_at TEXT, PRIMARY KEY (user_id, date));
      CREATE TABLE whoop_cycle_steps (user_id INTEGER, cycle_id INTEGER, date TEXT, cycle_start TEXT, cycle_end TEXT, step_count INTEGER, upstream_updated_at TEXT, fetched_at TEXT, PRIMARY KEY (user_id, cycle_id));
    `);
    const raw = JSON.stringify({
      start: new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString(),
      end: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
      updated_at: iso,
    });
    db.prepare("INSERT INTO users VALUES (7, 'smoke-subject', 'smoke@example.invalid', 'America/New_York')").run();
    db.prepare("INSERT INTO integrations VALUES (7, 'whoop', 0, 'smoke-provider', ?)").run(iso);
    db.prepare("INSERT INTO recovery VALUES (7, ?, 74, 62.5, 54, ?)").run(date, raw);
    db.prepare("INSERT INTO sleep VALUES (7, 'smoke-sleep', ?, 27900000, 18000000, 4500000, 3600000, 86, 0, ?)").run(date, raw);
    db.prepare("INSERT INTO cycles VALUES (7, ?, 10.8, ?)").run(date, raw);
    db.prepare("INSERT INTO daily_steps VALUES (7, ?, 7900, 'apple_health', ?)").run(date, iso);
    db.prepare("INSERT INTO whoop_cycle_steps VALUES (7, 7001, ?, ?, ?, 8123, ?, ?)").run(
      date,
      new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString(),
      new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
      iso,
      iso,
    );
  } finally {
    db.close();
  }
}

function runPackageCommand(
  overrides: Record<string, string | undefined>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...overrides,
    PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? ""}`,
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
  }

  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "frame:morning:publish"], {
      cwd: appRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("frame Morning package command timed out"));
    }, 15_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { body += chunk; });
    request.on("end", () => {
      received.push(JSON.parse(body));
      response.writeHead(204);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  webhookUrl = `http://127.0.0.1:${port}/api/webhook/smoke-private-id`;
});

beforeEach(() => {
  received.length = 0;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("frame Morning actual package command", () => {
  it("publishes unavailable and exits 1 for an invalid private binding", async () => {
    const result = await runPackageCommand({
      FRAME_MORNING_HA_WEBHOOK_URL: webhookUrl,
      FRAME_MORNING_USER_ID: "7",
      FRAME_MORNING_ACCOUNT_SUBJECT: undefined,
      FRAME_MORNING_EMAIL_SHA256: undefined,
    });
    expect(result.code).toBe(1);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ brief: { schema_version: 1, status: "unavailable" } });
    expect(`${result.stdout}${result.stderr}`).not.toContain(webhookUrl);
    expect(`${result.stdout}${result.stderr}`).not.toContain("smoke-private-id");
  }, 20_000);

  it("publishes an ok brief and exits 0 for a bound synthetic database", async () => {
    const dbFile = path.join(tmpRoot, "smoke.db");
    createSyntheticDb(dbFile);
    const result = await runPackageCommand({
      WHOOP_DB_PATH: dbFile,
      FRAME_MORNING_HA_WEBHOOK_URL: webhookUrl,
      FRAME_MORNING_USER_ID: "7",
      FRAME_MORNING_ACCOUNT_SUBJECT: "smoke-subject",
      FRAME_MORNING_EMAIL_SHA256: undefined,
    });
    expect(result.code).toBe(0);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      brief: {
        schema_version: 1,
        timezone: "America/New_York",
        status: "ok",
        metrics: {
          recovery_score: { value: 74, source: "whoop" },
          steps: { value: 8123, source: "whoop" },
        },
      },
    });
    expect(result.stdout).toContain("frame morning publish succeeded");
    expect(`${result.stdout}${result.stderr}`).not.toContain(webhookUrl);
    expect(`${result.stdout}${result.stderr}`).not.toContain("smoke-subject");
  }, 20_000);
});
