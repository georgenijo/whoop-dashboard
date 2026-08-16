# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal health analytics dashboard. Pulls Whoop wearable data into SQLite, renders it in a Next.js app, and exposes an LLM coach that runs tool-use queries against the data. Whoop ingestion runs server-side via `/api/sync` (Next.js `runWhoopSync`) and webhook handlers — there is no Python sync surface anymore (retired in Phase D).

## Commands

```bash
# Setup
cp .env.example .env          # WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, ANTHROPIC_API_KEY, VAULT_KEY, WHOOP_STATE_SECRET, JWT_SIGNING_KEY
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt   # only for scripts/* + tests/* (vault, integrations, migrations)
cd apps/web && npm install

# Run
cd apps/web && npm run dev    # http://localhost:3000

# Build
cd apps/web && npm run build  # production build (Turbopack)

# Manual sync — hit /api/sync from the Settings page or curl localhost:3000/api/sync.
# Webhook-driven syncs run automatically when Whoop POSTs to /api/whoop/webhook.
```

Python tests live in `tests/` and run via `pytest` (covers the vault + integrations helpers used by `scripts/migrate-whoop-tokens.py`). ESLint is wired via `eslint-config-next`.

### `scripts/coach` CLI (debug + inspection)

Query the running web app's coach state without hand-rolled remote SQL. Defaults to production on Fleet node `opti`; pass `--local` to hit `shared/whoop_data.db` instead. Read-only.

```bash
scripts/coach login                       # compatibility reachability check; no persistent session
scripts/coach threads --limit 10          # newest threads (filter with --source ios|web)
scripts/coach thread 49                   # full transcript (--tools, --thinking, --json, --since YYYY-MM-DD)
scripts/coach search "trigger_whoop_sync" # grep across chat_messages content + blocks
scripts/coach logs 49                     # chat_logs (timing/status) for thread
scripts/coach syncs --limit 10            # recent sync_logs (--source manual|webhook|cron|ios, --status error)
scripts/coach chat-detail 188             # full chat_logs row + parsed details JSON
scripts/coach journal "5 min ago" --grep chat   # journalctl whoop-web window (prod only)
scripts/coach settings --user 2           # user_settings row (key redacted)
scripts/coach why 82                      # forensic: chat_logs + journal + user_settings delta for a thread
scripts/coach --local threads             # local dev DB instead of prod
scripts/coach logout                      # compatibility no-op
```

Use this whenever debugging coach behavior — tool-use traces, missing replies, thinking blocks, latency outliers, sync failures. Pairs with the `coach-debug` skill at `~/.claude/skills/coach-debug/`.

## Architecture

### Repo layout

```
apps/web/         Next.js 16.2.4 (Turbopack, App Router) — active dashboard + API + Whoop sync
streamlit/whoop/  Python library modules (auth, integrations, vault, db helpers) used by scripts/ + tests/ ONLY — no UI app
shared/           shared SQLite (whoop_data.db, WAL mode)
scripts/          one-shot Python utilities (token migration, WAL smoke test)
tests/            pytest suite for the Python helper modules
tokens.json       Whoop OAuth tokens — legacy single-user file; integrations table is source of truth
```

### Stack

- Next.js 16.2.4 — **NOT the Next.js you know.** Read `apps/web/node_modules/next/dist/docs/` before writing code. APIs and conventions diverge from training-data Next.js. `apps/web/AGENTS.md` reinforces this.
- React 19 · TypeScript · Tailwind 4
- Recharts 3.8 for charts
- `@anthropic-ai/sdk` 0.91 for the Coach (Claude Sonnet 4.6, adaptive thinking, no `budget_tokens`)
- `better-sqlite3` 12 for synchronous DB access from Next.js
- `marked` 18 + DOMPurify for assistant message rendering

### Pages

```
/            Overview — recovery ring, KPI strip, AI insight, trend charts
/recovery    Recovery score, HRV, RHR
/sleep       Sleep stages, perf, efficiency, disturbances
/strain      Daily strain, kJ, HR averages
/workouts    Per-workout breakdown
/coach       LLM chat with persistent threads + tool-use
/logs        Sync history + chat call logs (with details dropdown)
/settings    Manual sync trigger, token info
```

### Coach (`apps/web/src/app/api/chat/route.ts`)

Agentic loop. Five tools defined in `src/lib/coach-tools.ts`:

- `query_recovery`, `query_sleep`, `query_strain`, `query_workouts`, `query_journal`
- All take `start_date` / `end_date` (YYYY-MM-DD), return raw rows from SQLite

Caps:
- `MAX_TOOL_ITERATIONS = 8` (round-trips, not parallel calls)
- `MAX_OUTPUT_TOKENS = 16384` (thinking + reply combined)
- On `stop_reason === "max_tokens"`, returns partial text with truncation marker (no throw)

Conversations are persisted in `chat_messages` keyed by `thread_id`. The model's `tool_use` and `tool_result` content blocks are stored as JSON in the `blocks` column so multi-turn conversations preserve full tool context across reloads. Synthetic `[tool_result]` rows are filtered from UI by `getChatMessages` and `getChatThreads` queries.

Threads have auto-titles via Haiku 4.5 fired in `after()` (Next.js post-response hook), only on first turn of a blank-title thread. Persistence is buffered in memory and committed atomically via `addChatMessages` (uses `db.transaction(fn)`) — failed API calls leave the DB untouched.

### DB layer (`apps/web/src/lib/db/`)

- Default path: `../../shared/whoop_data.db` from `apps/web`. Override with `WHOOP_DB_PATH` env var (used in tests).
- Schema migrations are **lazy ALTERs in `openWrite()`** at `apps/web/src/lib/db/connection.ts` — every write call ensures schema is current. No manual migration step. Pattern:
  ```ts
  if (!cols.some(c => c.name === "details")) {
    db.exec("ALTER TABLE chat_logs ADD COLUMN details TEXT");
  }
  ```
- All 5 Whoop domain tables are tenant-scoped by `user_id` (Phase D), but the **primary keys are NOT uniform** — verified against prod, and asserted per-table in `connection.test.ts`:

  | Table | PRIMARY KEY | Why |
  |---|---|---|
  | `recovery` | `(user_id, date)` | one per day |
  | `cycles` | `(user_id, date)` | one per day |
  | `daily_summary` | `(user_id, date)` | one per day |
  | `sleep` | `(user_id, sleep_id)` | a date carries naps **plus** the main sleep |
  | `workouts` | `(id)` | many per day; Whoop's own id |

  Assuming `(user_id, date)` everywhere is wrong and was the cause of a stale test suite. The rebuild runs once at first `openWrite()` against a pre-Phase-D DB — idempotent via `PRAGMA table_info` gate. **NEVER write domain tables from Python**; the Next.js side is the sole owner.
- Read paths against domain tables MUST go through `forUser(userId).all/get/read(...)` in `apps/web/src/lib/db/scoped.ts`. The wrapper appends `userId` as the trailing positional `?`; call sites write `... AND user_id = ?` as the LAST placeholder. A CI vitest (`scoped.test.ts`) blocks any stray `FROM recovery|cycles|sleep|workouts|daily_summary|body_measurements` outside the wrapper + allowlist.
- Other read paths use `safeQuery` (read-only open). Other write paths use `safeWriteQuery` or direct `openWrite()`.
- Lazy-bootstrapped tables: `users`, `sessions`, `chat_threads`, `chat_messages`, `chat_logs`, `sync_logs`, `route_logs`, `app_settings`, `integrations`, `user_settings`, `device_tokens`, `webhook_events`. `route_logs`'s migration is factored into `migrateRouteLogsSchema()` (`connection.ts`) so it can be shared with `logs.ts`'s `openRouteLogWrite()`, which deliberately opens its own connection instead of calling `openWrite()` — see that function's doc comment for the hot-path cost rationale (issue #505).

### Auth

`src/lib/auth.ts` exposes `requireAuth(req)`. Precedence: **Bearer → Cookie → 401**. Bearer (iOS) verifies a session JWT; cookie (`__Host-coach_session`) is set by the SIWA round-trip at `/api/auth/apple-web/callback`. No bootstrap fallback — unauthenticated requests get 401.

Public web requests are gated upstream by `apps/web/src/proxy.ts authGate()`, which 307s page requests to `/signin` and returns JSON 401 for API routes. Exempt prefixes: `/signin`, `/api/auth/`, `/api/whoop/webhook`, `/api/admin/`, `/api/health`.

`/api/health` returns build identity only (`{status}` publicly; `{status, sha, built_at, uptime_s}` to direct on-box callers) so `scripts/deploy` can verify which commit is actually serving traffic. Adding to this list is a policy change — it widens the unauthenticated surface, so it needs a Decisions Log entry, not just a code edit.

Admin routes use a separate gate keyed on `ADMIN_APPLE_SUB` env (fail-closed if unset).

### Security headers (`src/lib/security-headers.ts`)

Two response surfaces, deliberately split:

- **`next.config.ts` `headers()`** — enforcing, on every path *including* `/_next/static/*` (which the proxy matcher skips): `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS (prod only), plus a small enforcing `Content-Security-Policy` (`frame-ancestors`/`object-src`/`base-uri`/`form-action`, + `upgrade-insecure-requests` in prod).
- **`src/proxy.ts`** — `Content-Security-Policy-Report-Only`, carrying a fresh per-request nonce. It lives here because `headers()` runs once at server start and cannot mint a nonce. The nonce is set on the *request* headers; Next 16.2.4 parses it back out (it reads `content-security-policy` **or** `content-security-policy-report-only`) and stamps every script tag with it. All 24 inline scripts in a prod HTML response are nonce'd — `script-src 'self'` without a nonce does **not** work.

The full policy is report-only on purpose. Do not flip it to enforcing without reading collected violations first — and read `security-headers.ts`'s "Report coverage limits" doc comment before trusting a quiet report window: the collector attaches post-hydration (misses early-load violations), rate-limits at 10/s, caps at 20 distinct violations per **layout mount** (not per page load — an all-day SPA session can undercount), and was only verified against Chromium.

Violations are collected from the `securitypolicyviolation` DOM event in `ClientLogBootstrap` and forwarded through the already-authenticated, already-rate-limited `/api/log/client`, so they land in `client_logs` and render on `/logs` under the "Client events" card (`message = 'csp-violation'`; expand a row for directive/blocked-URI detail). There is deliberately no `report-uri` endpoint — that would require adding an unauthenticated POST route to `AUTH_EXEMPT_PREFIXES`. See `docs/decisions/DECISIONS.md` (2026-08-16).

Adding a third-party script, font, image host, or `fetch` target means widening a directive here. nginx/cloudflared sit in front in prod; the app is the source of truth, the proxy must not duplicate these.

### Data flow

1. OAuth callback (`/api/auth/callback`) verifies HMAC `state`, exchanges code → writes encrypted tokens to `integrations` row (user_id, provider='whoop'), fetches `/v2/user/profile/basic` and captures `provider_user_id` for webhook routing
2. `runWhoopSync({ userId })` (`apps/web/src/lib/sync.ts`) — pulls last 7 days from Whoop in parallel via `Promise.all`, upserts to `recovery`/`cycles`/`sleep`/`workouts` with `user_id` stamped, then calls `recomputeDailySummary(date, userId)`
3. Webhook handler (`apps/web/src/lib/whoop/webhook-handler.ts`) — Whoop POSTs an event with its own `user_id`; handler resolves to local `users.id` via `lookupUserIdByProvider("whoop", evt.user_id)`, fetches the resource, upserts with `user_id`. Unknown Whoop user → 200 noop (Whoop won't retry).
4. Web app reads through `forUser(userId).all/get(...)` (`apps/web/src/lib/db/scoped.ts`) — tenant binding enforced; `journal` is the only domain read still unscoped, deferred to Phase E.
5. Coach tools at `apps/web/src/lib/coach/tools.ts` receive `userId` from `executeTool({ userId })` and thread it into every `query_*` read fn.

### Key conventions

- Only records with `score_state == "SCORED"` are processed
- Naps excluded at query time (`WHERE nap = 0`), not at sync — naps still land in DB
- Whoop API base: `https://api.prod.whoop.com/developer`
- Required env: `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `ANTHROPIC_API_KEY`
- Optional env: `WHOOP_REDIRECT_URI`, `WHOOP_DB_PATH`, `WHOOP_TOKENS_PATH`
- Optional push env (iOS only, all five required for push to work): `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_PRIVATE_KEY`, `APNS_ENVIRONMENT`. Set `ENABLE_PUSH_DEBUG=1` to expose `/api/devices/test-push` in production.
- Use Anthropic SDK, not raw HTTP. Default model: `claude-sonnet-4-6` for chat, `claude-haiku-4-5` for titles.

## Deploy

Production runs entirely on Optiplex Fleet node `opti`. **System-level**
`whoop-web.service` (`/etc/systemd/system/whoop-web.service`, plus a
root-owned mode-600 `override.conf` drop-in) listens on `127.0.0.1:8501`;
restarting it needs `sudo`, which is passwordless for `george` on `opti`.
Public ingress is the shared system `cloudflared.service` (tunnel
`opti-murmur`), which maps `coach.georgenijo.com` and `coach-api.georgenijo.com`
straight to `127.0.0.1:8501` — no nginx and no certbot in the whoop path. (The
node does run nginx on `127.0.0.1:8601`, but that serves the unrelated
`georgenijo.com` static site and the Murmur endpoints.) Production is a plain
in-place git checkout at `/home/george/Documents/whoop-dashboard`; the
canonical database and secrets live under it. There is no `releases/` tree and
no `current` symlink.

Pull requests and pushes to `main` run GitHub Actions CI only. Deploys are
explicit operator actions from a machine with Fleet access, over `fleet exec`.
**Use `scripts/deploy`**: it snapshots the database, fetches over HTTPS and
`git reset --hard`s the checkout to the target ref, runs the Cursor Agent
launcher canary, reinstalls deps only when the lockfile changed, stages the old
build as `.next.prev`, builds with Node 20.20.2 **detached**, restarts
`whoop-web` with `sudo`, and verifies the running `/api/health` sha matches the
commit it just deployed before checking that the local (`127.0.0.1:8501`) and
public endpoints return 307.

```bash
scripts/deploy            # deploy origin/main
scripts/deploy --ref <r>  # deploy a specific ref (resolved on opti)
scripts/deploy --check    # report drift only (deployed / serving / target)
```

What it guarantees, and why each one is there:

- **DB snapshot first.** `sqlite3 -readonly ... VACUUM INTO` into
  `/home/george/whoop-db-backups/` (newest 10 kept), asserted with `PRAGMA
  quick_check` and a table-count comparison against the live DB. Never `cp`: the
  DB is WAL mode with a live writer, so a raw copy can restore as an EMPTY
  database and a copy straddling a checkpoint can tear it — both exit 0.
  Schema migrations are lazy `ALTER`s in `openWrite()`, so any deploy can
  migrate on the first write after restart.
- **Detached build.** `setsid` + an exit-code sentinel, polled over fresh
  connections. A foreground `next build` dies with a dropped connection and
  leaves an orphan holding the lock.
- **Sha verification.** "The service is up" does not catch a restart that kept
  serving the old bundle; the deployed sha is compared against `/api/health`.
- **Rollback recipe** printed on success and on any failure after the snapshot,
  covering both the build-level rollback and the DB restore (delete the
  `-wal`/`-shm` sidecars FIRST, or a leftover WAL replays onto the restored file
  and blends two database states). It is **single-step only** — the next deploy
  overwrites `.next.prev`.

Use `fleet exec opti '<command>'` for diagnostics; never address a production
IP directly. Logs are available with
`fleet exec opti 'sudo journalctl -u whoop-web -n 200 --no-pager'`. The
legacy-named `vm-ops` skill contains the current Fleet procedures.

For direct smoke tests, run curl on `opti` against `127.0.0.1:8501`.
`/api/health` is auth-exempt and returns the running build SHA to on-box callers.
Full initial provisioning, Oracle-to-opti data migration, rollback, tunnel,
backup, and retirement procedures are in
`docs/operations/environment-and-deploy.md`. Do not delete the Oracle instance
until its production database and `.env.local` have been recovered and checked.

Whoop sync runs server-side: cron-triggered via `/api/sync`, real-time via webhooks at `/api/whoop/webhook`. There is no Python sync script anymore — `python sync/daily_sync.py` was retired in Phase D.

## Local verification (live testing)

Worktrees created via `git worktree add` don't carry `shared/whoop_data.db`, `tokens.json`, or `.env` — those live only in the main worktree. Use the **`whoop-dev` skill** at `~/.claude/skills/whoop-dev/` to spin up a dev server in any worktree against a snapshot of the production DB. Pairs with the **`agent-browser` CLI** (global npm; `agent-browser skills get core --full` for usage) for headless render/behavior verification.

```bash
# Up: snapshots shared DB → /tmp/whoop-dev-<port>.db, starts dev, returns JSON
RESULT=$(bash ~/.claude/skills/whoop-dev/bin/up.sh <worktree-path> [--seed <scenario>])
URL=$(echo "$RESULT"  | jq -r .url)
PORT=$(echo "$RESULT" | jq -r .port)

# Drive Chrome via agent-browser against $URL/<route>:
#   agent-browser open "$URL/<route>"
#   agent-browser snapshot -i        # @e refs for interactive elements
#   agent-browser click @eN          # act on refs; re-snapshot after page change
#   agent-browser close              # tear down browser session

# Down: kill, remove temp DB + log, drop from state
bash ~/.claude/skills/whoop-dev/bin/down.sh --port $PORT
```

Seed scenarios (in `bin/seed.sh`): `sync-skip` (sync_logs ok row -2min), `sync-skip-old` (-10min), `sync-empty`. Add new scenarios as needed — append a case to `seed.sh` and a row to the SKILL.md table.

Use this whenever typecheck + lint alone won't catch the bug:
- UI render correctness (chart paths, tooltip values, layout)
- Behavior under specific DB state (cooldown gates, empty data, stale tokens)
- API route response shape after a code change

Don't use it for production debugging (use the legacy-named `vm-ops` skill) or anything needing a real Whoop API call (this skill doesn't copy `tokens.json`).

## Issue taxonomy

Labels (case-sensitive):
- `feature` — user-facing capability
- `foundation` — infrastructure / prerequisite work
- `backlog` — low-priority, deferred
- `bug` — bug fix
- `codex-ready` — self-contained, ready for AI dispatch

Don't reintroduce `enhancement` or `rebuild` (deprecated).

## Decisions log

Architectural, scope, and process decisions live in `docs/decisions/DECISIONS.md` (running log, newest first). Read it before suggesting direction changes or revisiting locked tradeoffs. Maintained via the `/decisions` skill at `~/.claude/skills/decisions/`.

For deep one-off rationale on big locked decisions, write an ADR alongside in `docs/decisions/YYYY-MM-DD-*.md` and reference it from the log.

## Working notes

- Schema migration changes go in `openWrite()`. Add the ALTER right after the relevant `CREATE TABLE` block, gated by a `PRAGMA table_info` check.
- When changing the API contract (e.g., adding a column to a response), check `apps/web/src/components/` for consumers — there's no shared types layer yet, types are per-file.
- Avoid Co-Authored-By lines in commit messages (per global ~/.claude/CLAUDE.md).
- Avoid Claude/Anthropic attribution on PRs, branches, or issue bodies.
