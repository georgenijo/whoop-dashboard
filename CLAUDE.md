# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal health analytics dashboard. Pulls Whoop wearable data into SQLite, renders it in a Next.js app, and exposes an LLM coach that runs tool-use queries against the data. A legacy Streamlit app is bundled but no longer the primary surface.

## Commands

```bash
# Setup
cp .env.example .env          # WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, ANTHROPIC_API_KEY
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cd apps/web && npm install

# Run
cd apps/web && npm run dev    # http://localhost:3000  (active)
streamlit run streamlit/app.py # http://localhost:8501  (legacy)

# Build
cd apps/web && npm run build  # production build (Turbopack)

# Manual sync
python sync/daily_sync.py     # last 7 days, parallel fetch, upsert into SQLite
```

No Python test suite. ESLint is wired via `eslint-config-next`.

## Architecture

### Repo layout

```
apps/web/         Next.js 16.2.4 (Turbopack, App Router) — active dashboard + API
streamlit/        legacy Streamlit + Plotly + pandas
sync/             daily_sync.py (Whoop pull) + daily_summary.py (per-day rollup)
shared/           shared SQLite (whoop_data.db, WAL mode)
tokens.json       Whoop OAuth tokens (gitignored, repo root)
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

### DB layer (`apps/web/src/lib/db.ts`)

- Default path: `../../shared/whoop_data.db` from `apps/web`. Override with `WHOOP_DB_PATH` env var (used in tests).
- Schema migrations are **lazy ALTERs in `openWrite()`** — every write call ensures schema is current. No manual migration step. Pattern:
  ```ts
  if (!cols.some(c => c.name === "details")) {
    db.exec("ALTER TABLE chat_logs ADD COLUMN details TEXT");
  }
  ```
- Read paths use `safeQuery` (read-only open). Write paths use `safeWriteQuery` or direct `openWrite()`.
- Lazy-bootstrapped tables: `users`, `sessions`, `chat_threads`, `chat_messages`, `chat_logs`, `sync_logs`, `daily_summary`, `app_settings`, `integrations` (planned).

### Auth

`src/lib/auth.ts` exposes `requireAuth(req)`. With no `Authorization` header, falls back to `getBootstrapUser()` → user_id=1. Single-user today; multi-user is future work.

### Data flow

1. OAuth callback writes tokens to `tokens.json` (atomic tmp+rename, thread-safe refresh in `streamlit/whoop/auth.py`)
2. `sync/daily_sync.py` runs — pulls last 7 days from Whoop in parallel via `ThreadPoolExecutor(max_workers=5)`, upserts to `recovery`, `cycles`, `sleep`, `workouts`
3. `compute_daily_summary` builds denormalized per-day rows in `daily_summary`
4. Web app reads from same SQLite via `db.ts`
5. Coach tools query the same DB by date range

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
ssh ubuntu@<vm-ip>
sudo -u george bash -c 'cd /home/george/Documents/whoop-dashboard && git pull origin main'
sudo -u george bash -c 'cd /home/george/Documents/whoop-dashboard/apps/web && npm ci && npm run build'
sudo systemctl restart whoop-web
```

Public domain has an auth gate (302 to login). For VM-side smoke tests, hit `localhost:8501` directly to bypass.

The VM has no `sqlite3` binary — query via `sudo -u george python3 -c "import sqlite3; ..."`.

No cron / systemd timer for `daily_sync.py` yet. All syncs are manual today (via `/api/sync` from Settings or the script directly).

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
