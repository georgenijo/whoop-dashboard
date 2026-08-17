#!/usr/bin/env node
// scripts/bench-coach.mjs
//
// Bench harness for Cursor Coach turn latency. POSTs to /api/chat?stream=true
// against a running whoop-dashboard dev instance, times the SSE stream
// client-side (time-to-first-byte, time-to-first text_delta, time-to-done),
// then reads back the matching chat_logs row's details.cursor.timing
// (server-side segments written by the Cursor lifecycle instrumentation — see
// DetailState["cursor"] in apps/web/src/lib/coach/loop.ts) for a side-by-side
// view.
//
// The bench HARD-FAILS if a successful run's chat_logs row is missing or its
// details.provider is not "cursor" — that means the target server silently ran
// the Anthropic path (usually a missing CURSOR_API_KEY), which would produce
// believable but meaningless Cursor latency numbers.
//
// No dependencies beyond what apps/web already vendors (better-sqlite3, jose)
// — resolved via createRequire anchored at apps/web/, so this script needs
// nothing installed at the repo root or in scripts/.
//
// See scripts/BENCH.md for prerequisites and usage.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const WEB_DIR = path.join(REPO_ROOT, "apps", "web");

const requireFromWeb = createRequire(path.join(WEB_DIR, "package.json"));
/** @type {typeof import("better-sqlite3")} */
const Database = requireFromWeb("better-sqlite3");
/** @type {typeof import("jose")} */
const { SignJWT } = requireFromWeb("jose");

// Must match apps/web/src/lib/auth/jwt.ts exactly (issuer + alg) — this is
// how the minted token verifies against the target server's requireAuth().
const JWT_ISSUER = "coach-api";
const JWT_ALG = "HS256";

// Must match apps/web/src/lib/coach/provider.ts CURSOR_PREF exactly, or the
// server falls back to the Anthropic default (resolveCoachProvider).
const CURSOR_MODEL_PREF = "cursor:composer-2.5-fast";

const DEFAULT_PROMPTS = [
  "How was my recovery today?",
  "How did I sleep last night?",
  "How am I doing today?",
  "How has my HRV changed over the last 14 days?",
];

// Hosts that route to the real production deployment. A sweep against either
// of these spends real API budget on the shared key and pollutes production
// chat_logs (see issue #446) — refuse by default, not just warn.
const PROD_HOSTS = new Set(["coach.georgenijo.com", "coach-api.georgenijo.com"]);

const HELP = `bench-coach — latency bench harness for the Cursor coach turn

Usage:
  node scripts/bench-coach.mjs --url http://localhost:3100 --db /tmp/whoop-dev-3100.db [options]

Required:
  --url <url>        Base URL of the running dev instance (no trailing slash).
  --db <path>        Path to that instance's SQLite DB (WHOOP_DB_PATH it was
                      started with) — read for chat_logs.details.cursor.timing,
                      and written to seed the bench user.

Options:
  --runs <N>         Repetitions per prompt (default 3).
  --prompts <file>   Text file, one prompt per line ('#' comments / blank
                      lines skipped). Default: 4 built-in prompts.
  --env <path>       .env file to read JWT_SIGNING_KEY from. Defaults to
                      trying apps/web/.env then .env at the repo root of
                      *this* checkout; must match the key the TARGET server
                      was started with, which usually means the target
                      worktree's .env (see BENCH.md).
  --user-id <N>      Reuse an existing user_id instead of seeding a bench
                      user (skips the users/user_settings upsert).
  --apple-sub <str>  apple_sub to seed the bench user under (default
                      "bench-coach-harness"). Idempotent across reruns.
  --email <str>      Email to seed the bench user with (cosmetic only).
  --reuse-thread     Reuse one thread across all runs of a given prompt
                      instead of a fresh thread per run (default: fresh
                      thread per run, so runs don't inherit conversation
                      history / prior tool context).
  --allow-prod       Required (in addition to typing the URL) to run against
                      a production host (coach.georgenijo.com /
                      coach-api.georgenijo.com). Refused otherwise — a sweep
                      spends real API budget on the shared key and pollutes
                      production chat_logs. BENCH_ALLOW_PROD=1 works too, for
                      non-interactive callers.
  -h, --help         Show this help.

The DB must already have its schema bootstrapped (users, chat_threads,
chat_messages, chat_logs, user_settings) — that happens lazily the first
time the target app performs any DB write. If those tables don't exist yet,
start the target app and let it handle one request first (see BENCH.md),
then rerun this script.
`;

// Numeric flags fail loudly like every other argument — a typo must not
// silently fall back to a default.
function positiveInt(flag, raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${flag} expects a positive integer, got: ${raw}`);
  }
  return n;
}

function parseArgs(argv) {
  const args = {
    url: null,
    db: null,
    runs: 3,
    prompts: null,
    env: null,
    userId: null,
    email: "bench@local.test",
    appleSub: "bench-coach-harness",
    reuseThread: false,
    allowProd: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--url":
        args.url = argv[++i];
        break;
      case "--db":
        args.db = argv[++i];
        break;
      case "--runs":
        args.runs = positiveInt("--runs", argv[++i]);
        break;
      case "--prompts":
        args.prompts = argv[++i];
        break;
      case "--env":
        args.env = argv[++i];
        break;
      case "--user-id":
        args.userId = positiveInt("--user-id", argv[++i]);
        break;
      case "--email":
        args.email = argv[++i];
        break;
      case "--apple-sub":
        args.appleSub = argv[++i];
        break;
      case "--reuse-thread":
        args.reuseThread = true;
        break;
      case "--allow-prod":
        args.allowProd = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${a} (--help for usage)`);
    }
  }
  if (args.url) args.url = args.url.replace(/\/+$/, "");
  return args;
}

function loadEnvFile(p) {
  const out = {};
  if (!p || !existsSync(p)) return out;
  const text = readFileSync(p, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function resolveJwtSigningKey(args) {
  if (process.env.JWT_SIGNING_KEY) return process.env.JWT_SIGNING_KEY;
  const candidates = [];
  if (args.env) candidates.push(args.env);
  candidates.push(path.join(WEB_DIR, ".env"));
  candidates.push(path.join(REPO_ROOT, ".env"));
  for (const c of candidates) {
    const parsed = loadEnvFile(c);
    if (parsed.JWT_SIGNING_KEY) return parsed.JWT_SIGNING_KEY;
  }
  throw new Error(
    "JWT_SIGNING_KEY not found. Set it in the environment, or pass " +
      "--env <path> pointing at the TARGET server's .env (checked: " +
      `${candidates.join(", ")}). It must be the exact same key the target ` +
      "server was started with, or the minted token won't verify."
  );
}

async function signSessionToken(userId, rawKey) {
  let bytes;
  try {
    bytes = Buffer.from(rawKey, "base64");
  } catch {
    throw new Error("JWT_SIGNING_KEY must be base64-encoded");
  }
  if (bytes.length < 32) {
    throw new Error("JWT_SIGNING_KEY must decode (base64) to at least 32 bytes");
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + 30 * 24 * 60 * 60; // 30 days — mirrors auth/jwt.ts
  return new SignJWT({})
    .setProtectedHeader({ alg: JWT_ALG })
    .setSubject(String(userId))
    .setIssuer(JWT_ISSUER)
    .setIssuedAt(nowSec)
    .setExpirationTime(expSec)
    .sign(new Uint8Array(bytes));
}

/**
 * Refuse (not warn) when --url resolves to a production host, unless the
 * caller explicitly opted in via --allow-prod or BENCH_ALLOW_PROD=1. A
 * benchmark sweep is real model turns on the shared Cursor key, landing in
 * production chat_logs — see issue #446.
 */
function guardAgainstProd(url, allowProd) {
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(`--url ${url} is not a valid URL`);
  }
  if (!PROD_HOSTS.has(hostname)) return;
  if (allowProd || process.env.BENCH_ALLOW_PROD === "1") return;
  throw new Error(
    `refusing to bench against production host "${hostname}".\n` +
      "  A sweep runs real model turns on the shared Cursor key and writes " +
      "to production chat_logs (see issue #446).\n" +
      "  If you really mean it, rerun with --allow-prod or BENCH_ALLOW_PROD=1."
  );
}

function requireTable(db, name) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  if (!row) {
    throw new Error(
      `Table "${name}" not found in the target DB. Schema is bootstrapped ` +
        "lazily by the app on its first DB write — start the target app and " +
        "let it serve one request first (see scripts/BENCH.md), then rerun."
    );
  }
}

function openBenchDb(dbPath) {
  if (!existsSync(dbPath)) {
    throw new Error(`--db ${dbPath} does not exist.`);
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  for (const t of ["users", "chat_threads", "chat_messages", "chat_logs", "user_settings"]) {
    requireTable(db, t);
  }
  return db;
}

/** Idempotent: reruns reuse the same bench user via the apple_sub UNIQUE constraint. */
function seedBenchUser(db, { appleSub, email }) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO users (apple_sub, email, name, created_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(apple_sub) DO UPDATE SET email = excluded.email"
  ).run(appleSub, email, "bench-coach", now);
  const user = db.prepare("SELECT id FROM users WHERE apple_sub = ?").get(appleSub);
  db.prepare(
    "INSERT INTO user_settings (user_id, model_pref, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET model_pref = excluded.model_pref, updated_at = excluded.updated_at"
  ).run(user.id, CURSOR_MODEL_PREF, now);
  return user.id;
}

function loadPrompts(filePath) {
  if (!filePath) return DEFAULT_PROMPTS.slice();
  const text = readFileSync(filePath, "utf8");
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (lines.length === 0) {
    throw new Error(`--prompts ${filePath} contained no usable lines`);
  }
  return lines;
}

// --- one SSE turn ----------------------------------------------------------

async function runOneTurn({ url, token, prompt, threadId }) {
  const t0 = performance.now();
  const body = JSON.stringify({
    messages: [{ role: "user", content: prompt }],
    thread_id: threadId ?? null,
  });

  let resp;
  try {
    resp = await fetch(`${url}/api/chat?stream=true`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body,
    });
  } catch (err) {
    return {
      ok: false,
      threadId: null,
      error: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      ttfbMs: null,
      ttftMs: null,
      totalMs: performance.now() - t0,
    };
  }

  const respThreadId = Number(resp.headers.get("x-thread-id")) || threadId || null;

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    return {
      ok: false,
      threadId: respThreadId,
      error: `HTTP ${resp.status}: ${text.slice(0, 300)}`,
      ttfbMs: null,
      ttftMs: null,
      totalMs: performance.now() - t0,
    };
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ttfbMs = null;
  let ttftMs = null;
  let doneMs = null;
  let sawError = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (ttfbMs === null) ttfbMs = performance.now() - t0;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      // Bare comment frames (": ready" on open, ": hb" heartbeats) — not real
      // events, skip. Note the immediate ": ready" flush means ttfb measures
      // the server's first flush, not the first model output.
      if (!rawEvent || rawEvent.startsWith(":")) continue;

      let eventName = "message";
      let dataLine = null;
      for (const line of rawEvent.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLine = line.slice(5).trim();
      }
      if (dataLine === null) continue;

      let data;
      try {
        data = JSON.parse(dataLine);
      } catch {
        continue;
      }

      if (eventName === "text_delta" && ttftMs === null) {
        ttftMs = performance.now() - t0;
      } else if (eventName === "done") {
        doneMs = performance.now() - t0;
      } else if (eventName === "error") {
        sawError = data;
        doneMs = performance.now() - t0;
      }
    }
  }

  return {
    ok: sawError === null,
    threadId: respThreadId,
    error: sawError ? sawError.message ?? JSON.stringify(sawError) : null,
    ttfbMs,
    ttftMs,
    totalMs: doneMs ?? performance.now() - t0,
  };
}

/**
 * Reads the newest chat_logs row for a thread and pulls out what the bench
 * reports on. Returns null when there is no usable row at all (no thread id,
 * no row, unparseable details) — the caller decides whether that is fatal.
 *
 * `provider` is the top-level discriminator written by the coach loop;
 * `timing` may legitimately be null on an older build that persisted a
 * `cursor` object without the timing block, which renders as n/a rather than
 * failing.
 */
function readCursorDetails(db, threadId) {
  if (threadId == null) return null;
  const row = db
    .prepare("SELECT details FROM chat_logs WHERE thread_id = ? ORDER BY id DESC LIMIT 1")
    .get(threadId);
  if (!row || !row.details) return null;
  let parsed;
  try {
    parsed = JSON.parse(row.details);
  } catch {
    return null;
  }
  const toolEvents = parsed.cursor?.tool_events;
  return {
    provider: parsed.provider ?? null,
    timing: parsed.cursor?.timing ?? null,
    toolCompletedCount: Array.isArray(toolEvents)
      ? toolEvents.filter((e) => e?.phase === "completed").length
      : null,
  };
}

/**
 * A run that streamed successfully but did not land a Cursor chat_logs row is
 * never a soft "n/a" — it means the numbers on screen are not measuring what
 * the bench claims to measure, so the whole run aborts.
 */
function assertCursorProvider(details, threadId) {
  const observed = details?.provider ?? null;
  if (observed === "cursor") return;
  const what =
    details === null
      ? `no chat_logs row found for thread_id=${threadId}`
      : `chat_logs.details.provider = ${JSON.stringify(observed)} (expected "cursor")`;
  throw new Error(
    `aborting bench: ${what}.\n` +
      "  The turn completed, but it did not run through the Cursor provider — " +
      "the reported latencies would be believable and invalid.\n" +
      "  Most likely cause: the TARGET server has no CURSOR_API_KEY set, so " +
      "resolveCoachProvider() silently fell back to Anthropic despite the " +
      `bench user's model_pref of "${CURSOR_MODEL_PREF}".\n` +
      "  Fix the target server's env (see scripts/BENCH.md) and rerun."
  );
}

// --- stats + formatting ------------------------------------------------------

function percentile(values, p) {
  const nums = values
    .filter((v) => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const idx = Math.min(nums.length - 1, Math.ceil((p / 100) * nums.length) - 1);
  return nums[Math.max(0, idx)];
}

function fmt(v) {
  return v === null || v === undefined ? "  n/a" : String(Math.round(v)).padStart(5);
}

// --- main --------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (!args.url || !args.db) {
    console.error("bench-coach: --url and --db are required\n");
    console.log(HELP);
    process.exit(1);
  }
  const runs = args.runs;

  guardAgainstProd(args.url, args.allowProd);

  const signingKey = resolveJwtSigningKey(args);
  const db = openBenchDb(args.db);
  const userId = args.userId ?? seedBenchUser(db, { appleSub: args.appleSub, email: args.email });
  const token = await signSessionToken(userId, signingKey);
  const prompts = loadPrompts(args.prompts);
  const totalTurns = prompts.length * runs;

  console.log(
    `bench-coach: url=${args.url} db=${args.db} user_id=${userId} runs=${runs} prompts=${prompts.length}`
  );
  console.log(
    `bench-coach: about to run ${totalTurns} real model turn${totalTurns === 1 ? "" : "s"} ` +
      `(${prompts.length} prompt${prompts.length === 1 ? "" : "s"} x ${runs} run${runs === 1 ? "" : "s"}) against ${args.url}`
  );
  console.log("");

  const allRows = [];

  for (const prompt of prompts) {
    console.log(`=== ${JSON.stringify(prompt)} ===`);
    console.log(
      "run  ttfb_ms ttft_ms total_ms | srv_event srv_text srv_tool srv_total tools | status"
    );
    const perPrompt = [];
    let threadId = null;
    for (let i = 1; i <= runs; i++) {
      const result = await runOneTurn({
        url: args.url,
        token,
        prompt,
        threadId: args.reuseThread ? threadId : null,
      });
      threadId = result.threadId ?? threadId;
      const details = readCursorDetails(db, result.threadId);
      // Only assert on runs that actually completed — a failed run has its own
      // error surfaced in the status column and may legitimately have no row.
      if (result.ok) assertCursorProvider(details, result.threadId);
      const timing = details?.timing ?? null;
      const row = {
        run: i,
        ttfbMs: result.ttfbMs,
        ttftMs: result.ttftMs,
        totalMs: result.totalMs,
        srvEvent: timing?.spawn_to_first_event_ms ?? null,
        srvText: timing?.spawn_to_first_assistant_text_ms ?? null,
        srvTool: timing?.spawn_to_first_tool_event_ms ?? null,
        srvTotal: timing?.turn_ms ?? null,
        toolCalls: details?.toolCompletedCount ?? null,
        status: result.ok ? "ok" : `err: ${result.error}`,
      };
      perPrompt.push(row);
      allRows.push(row);
      console.log(
        `${String(i).padStart(3)}  ${fmt(row.ttfbMs)}  ${fmt(row.ttftMs)}  ${fmt(row.totalMs)} | ` +
          `${fmt(row.srvEvent)}   ${fmt(row.srvText)}  ${fmt(row.srvTool)}  ${fmt(row.srvTotal)}  ${fmt(
            row.toolCalls
          )} | ${row.status}`
      );
    }

    const p50 = (key) => percentile(perPrompt.map((r) => r[key]), 50);
    const p95 = (key) => percentile(perPrompt.map((r) => r[key]), 95);
    console.log(
      `p50  ${fmt(p50("ttfbMs"))}  ${fmt(p50("ttftMs"))}  ${fmt(p50("totalMs"))} | ` +
        `${fmt(p50("srvEvent"))}   ${fmt(p50("srvText"))}  ${fmt(p50("srvTool"))}  ${fmt(p50("srvTotal"))}`
    );
    console.log(
      `p95  ${fmt(p95("ttfbMs"))}  ${fmt(p95("ttftMs"))}  ${fmt(p95("totalMs"))} | ` +
        `${fmt(p95("srvEvent"))}   ${fmt(p95("srvText"))}  ${fmt(p95("srvTool"))}  ${fmt(p95("srvTotal"))}`
    );
    console.log("");
  }

  if (prompts.length > 1) {
    console.log("=== aggregate across all prompts ===");
    const p50 = (key) => percentile(allRows.map((r) => r[key]), 50);
    const p95 = (key) => percentile(allRows.map((r) => r[key]), 95);
    console.log(
      `p50  ttfb=${fmt(p50("ttfbMs"))} ttft=${fmt(p50("ttftMs"))} total=${fmt(p50("totalMs"))} | srv_total=${fmt(
        p50("srvTotal")
      )}`
    );
    console.log(
      `p95  ttfb=${fmt(p95("ttfbMs"))} ttft=${fmt(p95("ttftMs"))} total=${fmt(p95("totalMs"))} | srv_total=${fmt(
        p95("srvTotal")
      )}`
    );
  }

  db.close();
}

main().catch((err) => {
  console.error(`bench-coach: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
