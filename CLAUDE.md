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
- The 5 Whoop domain tables (`recovery`, `cycles`, `sleep`, `workouts`, `daily_summary`) use composite PK `(user_id, date)` (Phase D). The rebuild runs once at first `openWrite()` against a pre-Phase-D DB — idempotent via `PRAGMA table_info` gate. **NEVER write domain tables from Python**; the Next.js side is the sole owner.
- Read paths against domain tables MUST go through `forUser(userId).all/get/read(...)` in `apps/web/src/lib/db/scoped.ts`. The wrapper appends `userId` as the trailing positional `?`; call sites write `... AND user_id = ?` as the LAST placeholder. A CI vitest (`scoped.test.ts`) blocks any stray `FROM recovery|cycles|sleep|workouts|daily_summary|body_measurements` outside the wrapper + allowlist.
- Other read paths use `safeQuery` (read-only open). Other write paths use `safeWriteQuery` or direct `openWrite()`.
- Lazy-bootstrapped tables: `users`, `sessions`, `chat_threads`, `chat_messages`, `chat_logs`, `sync_logs`, `app_settings`, `integrations`, `user_settings`, `device_tokens`, `webhook_events`.

### Auth

`src/lib/auth.ts` exposes `requireAuth(req)`. Precedence: **Bearer → Cookie → 401**. Bearer (iOS) verifies a session JWT; cookie (`__Host-coach_session`) is set by the SIWA round-trip at `/api/auth/apple-web/callback`. No bootstrap fallback — unauthenticated requests get 401.

Public web requests are gated upstream by `apps/web/src/proxy.ts authGate()`, which 307s page requests to `/signin` and returns JSON 401 for API routes. Exempt prefixes: `/signin`, `/api/auth/`, `/api/whoop/webhook`, `/api/admin/`.

Admin routes use a separate gate keyed on `ADMIN_APPLE_SUB` env (fail-closed if unset).

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

VM (Ubuntu) runs `whoop-web.service` (systemd) on port 8501. Deploy flow:

```bash
# 1. Snapshot the DB BEFORE any schema-touching change (Phase D et al). Stash
#    a timestamped copy locally so a failed migration is a 30-second rollback.
TS=$(date +%Y%m%d-%H%M%S)
scp ubuntu@<vm-ip>:/home/george/Documents/whoop-dashboard/shared/whoop_data.db \
    "$HOME/whoop_data.db.backup.$TS"
#    Rollback recipe (only if migration fails):
#      ssh ubuntu@<vm-ip> 'sudo systemctl stop whoop-web'
#      scp "$HOME/whoop_data.db.backup.$TS" \
#          ubuntu@<vm-ip>:/home/george/Documents/whoop-dashboard/shared/whoop_data.db
#      ssh ubuntu@<vm-ip> 'sudo -u george git -C /home/george/Documents/whoop-dashboard checkout <prev-sha>'
#      ssh ubuntu@<vm-ip> 'cd /home/george/Documents/whoop-dashboard/apps/web && sudo -u george npm ci && sudo -u george npm run build && sudo systemctl start whoop-web'

# 2. Standard deploy
ssh ubuntu@<vm-ip>
sudo -u george bash -c 'cd /home/george/Documents/whoop-dashboard && git pull origin main'
sudo -u george bash -c 'cd /home/george/Documents/whoop-dashboard/apps/web && npm ci && npm run build'
sudo systemctl restart whoop-web

# 3. Post-deploy verification (hit localhost to bypass CF Access)
curl -sS http://localhost:8501/api/dashboard/today | jq .
sudo -u george python3 -c "import sqlite3; \
  conn = sqlite3.connect('/home/george/Documents/whoop-dashboard/shared/whoop_data.db'); \
  for t in ['recovery','cycles','sleep','workouts','daily_summary']: \
      n = conn.execute(f'SELECT COUNT(*) FROM {t} WHERE user_id IS NOT NULL').fetchone()[0]; \
      print(t, n)"
```

Public domain has an auth gate (302 to login). For VM-side smoke tests, hit `localhost:8501` directly to bypass.

The VM has no `sqlite3` binary — query via `sudo -u george python3 -c "import sqlite3; ..."`.

Whoop sync runs server-side: cron-triggered via `/api/sync`, real-time via webhooks at `/api/whoop/webhook`. There is no Python sync script anymore — `python sync/daily_sync.py` was retired in Phase D.

## Local verification (live testing)

Worktrees created via `git worktree add` don't carry `shared/whoop_data.db`, `tokens.json`, or `.env` — those live only in the main worktree. Use the **`whoop-dev` skill** at `~/.claude/skills/whoop-dev/` to spin up a dev server in any worktree against a snapshot of the production DB. Pairs with `claude-in-chrome` MCP for headless render/behavior verification.

```bash
# Up: snapshots shared DB → /tmp/whoop-dev-<port>.db, starts dev, returns JSON
RESULT=$(bash ~/.claude/skills/whoop-dev/bin/up.sh <worktree-path> [--seed <scenario>])
URL=$(echo "$RESULT"  | jq -r .url)
PORT=$(echo "$RESULT" | jq -r .port)

# Drive Chrome via mcp__claude-in-chrome__* against $URL/<route>, run inline JS checks.

# Down: kill, remove temp DB + log, drop from state
bash ~/.claude/skills/whoop-dev/bin/down.sh --port $PORT
```

Seed scenarios (in `bin/seed.sh`): `sync-skip` (sync_logs ok row -2min), `sync-skip-old` (-10min), `sync-empty`. Add new scenarios as needed — append a case to `seed.sh` and a row to the SKILL.md table.

Use this whenever typecheck + lint alone won't catch the bug:
- UI render correctness (chart paths, tooltip values, layout)
- Behavior under specific DB state (cooldown gates, empty data, stale tokens)
- API route response shape after a code change

Don't use it for VM debugging (use `vm-ops`) or anything needing a real Whoop API call (this skill doesn't copy `tokens.json`).

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
