# Whoop Dashboard

Personal health analytics dashboard. Pulls recovery, sleep, strain, and workout data from the Whoop API, stores it in SQLite, and renders it in a Next.js web app with an LLM-powered coach.

Multi-tenant under the hood — every read/write is `user_id`-scoped (Phase D). Sign in with Apple on web and iOS; bring-your-own Whoop OAuth and Anthropic key.

## Stack

| Layer | Tech |
|---|---|
| Web app | Next.js 16.2.4 (Turbopack, App Router) · React 19 · TypeScript · Tailwind 4 |
| Charts | Recharts 3.8 |
| AI coach | Anthropic SDK · Claude Sonnet 4.6 with adaptive thinking · 5 server-side tools (recovery/sleep/strain/workouts/journal) |
| Markdown render | marked 18 + DOMPurify |
| Data store | SQLite (WAL) via better-sqlite3 — `shared/whoop_data.db` |
| Sync | Next.js `runWhoopSync` (`apps/web/src/lib/sync.ts`) — manual via `/api/sync`, real-time via `/api/whoop/webhook` |
| Auth | Sign in with Apple (web + iOS) · per-user encrypted Whoop OAuth tokens in `integrations` table |
| Deploy | Ubuntu VM, systemd unit `whoop-web.service`, nginx |

## Repo layout

```
apps/web/         Next.js app — dashboard, API, Whoop sync, Coach (active surface)
streamlit/whoop/  Python helper modules (auth, integrations, vault) used by scripts/ + tests/ only
shared/           shared SQLite store (whoop_data.db)
scripts/          one-shot Python utilities (token migration, WAL smoke test)
tests/            pytest suite for Python helpers
tokens.json       legacy single-user OAuth file (gitignored); integrations table is source of truth
docs/             architecture diagrams, decisions log, post-mortems
```

## Setup

```bash
cp .env.example .env                  # fill WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, VAULT_KEY, WHOOP_STATE_SECRET, JWT_SIGNING_KEY, ANTHROPIC_API_KEY
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt       # only needed if you run scripts/ or tests/
cd apps/web && npm install
```

## Run

```bash
cd apps/web && npm run dev            # http://localhost:3000

# Manual sync — hit /api/sync from the Settings page, or:
curl -X POST http://localhost:3000/api/sync
```

First run: open the dashboard, sign in with Apple, hit Connect to Whoop, complete OAuth. Tokens land encrypted in the `integrations` table.

## Pages

| Path | Purpose |
|---|---|
| `/` | Overview — recovery ring, KPI strip, AI insight card, trend charts |
| `/recovery` | Recovery score, HRV, RHR over time |
| `/sleep` | Sleep stages, performance, efficiency, disturbances |
| `/strain` | Daily strain, kilojoules, HR averages |
| `/workouts` | Per-workout breakdown |
| `/coach` | LLM chat with persistent threads + tool-use access to your data |
| `/logs` | Sync history + chat call logs (with details dropdown) |
| `/settings` | Connect/Disconnect Whoop, manual sync trigger, token info |

## Coach (LLM tool-use)

`/api/chat` runs an agentic loop with Claude Sonnet 4.6. The model has 5 read tools plus `trigger_whoop_sync`:

- `query_recovery(start_date, end_date)`
- `query_sleep(start_date, end_date)`
- `query_strain(start_date, end_date)`
- `query_workouts(start_date, end_date)`
- `query_journal(start_date, end_date)`

All read tools are user-scoped via `forUser(userId)` (`apps/web/src/lib/db/scoped.ts`). Conversations live in `chat_messages` keyed by `thread_id`. The model's `tool_use` and `tool_result` content blocks are persisted as JSON in the `blocks` column so multi-turn conversations preserve full tool context across reloads. Auto-titles via Haiku 4.5.

Caps: 8 tool-use iterations, 16K output tokens. On `max_tokens` stop reason, partial reply is returned with a truncation marker.

## Data flow

1. OAuth callback (`/api/auth/callback`) verifies HMAC `state`, exchanges the code, encrypts tokens into the `integrations` row, fetches `/v2/user/profile/basic` and captures `provider_user_id` for webhook routing.
2. `runWhoopSync({ userId })` pulls last 7 days from Whoop in parallel and upserts to `recovery` / `cycles` / `sleep` / `workouts` with `user_id` stamped; `recomputeDailySummary(date, userId)` writes the per-day denormalized row.
3. Whoop webhooks at `/api/whoop/webhook` resolve `evt.user_id` → local `users.id` via `lookupUserIdByProvider("whoop", …)` and upsert. Unknown Whoop user → 200 noop.
4. Web pages and Coach tools read via `forUser(userId).all/get(...)` — tenant binding enforced; CI vitest blocks domain SQL outside the wrapper.

## Deploy

Ubuntu VM, `whoop-web.service` (systemd) on port 8501. **Backup the DB before any schema-touching deploy** — see `CLAUDE.md` "Deploy" section for the full recipe (scp the DB locally, deploy, verify row counts, rollback path on failure).

## Conventions

- Only Whoop records with `score_state == "SCORED"` are processed
- Naps excluded from sleep aggregations (`WHERE nap = 0`)
- Whoop API base: `https://api.prod.whoop.com/developer` (v2 endpoints)
- Schema migrations are lazy ALTERs / table rebuilds in `openWrite()` — idempotent, gated by `PRAGMA table_info` checks
- Domain reads route through `forUser(userId)` — `user_id = ?` is always the trailing positional `?`
- Co-Authored-By lines, Claude/Anthropic attribution on PRs/branches/issues — NOT allowed

## Environment

```
# Whoop OAuth
WHOOP_CLIENT_ID
WHOOP_CLIENT_SECRET
WHOOP_REDIRECT_URI       # default: http://localhost:3000/api/auth/callback
WHOOP_STATE_SECRET       # HMAC signing key for OAuth state nonce — required

# Vault (encrypts integrations.access_token/refresh_token + user_settings.anthropic_key)
VAULT_KEY                # base64 32-byte symmetric key — required for any encrypted column

# Session
JWT_SIGNING_KEY          # base64 32-byte signing key

# Coach
ANTHROPIC_API_KEY        # server fallback; per-user keys live in user_settings.anthropic_key

# DB
WHOOP_DB_PATH            # optional override for shared/whoop_data.db

# iOS (Sign in with Apple + APNs) — see .env.example for the APPLE_* / APNS_* set
```

## Status

Active. Phase D (data isolation) + Phase B-cleanup (CF Access dropped, bootstrap retired, SIWA-only gate) shipped. Phase E (onboarding wizard, /signup landing) is next — tracked at issue #328. Google Sign In is a follow-up (issue #329). Decisions log at `docs/decisions/DECISIONS.md` tracks ordering + open tradeoffs.
