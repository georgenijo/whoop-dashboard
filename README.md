# Whoop Dashboard

Personal health analytics dashboard. Pulls recovery, sleep, strain, and workout data from the Whoop API, stores it in SQLite, and renders it in a Next.js web app with an LLM-powered coach.

A legacy Streamlit UI is still bundled for reference; the Next.js app is the active surface.

## Stack

| Layer | Tech |
|---|---|
| Web app | Next.js 16.2.4 (Turbopack, App Router) · React 19 · TypeScript · Tailwind 4 |
| Charts | Recharts 3.8 |
| AI coach | Anthropic SDK · Claude Sonnet 4.6 with adaptive thinking · 5 server-side tools (recovery/sleep/strain/workouts/journal) |
| Markdown render | marked 18 + DOMPurify |
| Data store | SQLite (WAL) via better-sqlite3 — `shared/whoop_data.db` |
| Sync job | Python + requests (Whoop OAuth2) — `sync/daily_sync.py` |
| Legacy UI | Streamlit + Plotly + pandas — `streamlit/app.py` |
| Deploy | Ubuntu VM, systemd unit `whoop-web.service`, public via reverse proxy |

## Repo layout

```
apps/web/         Next.js app (active dashboard, port 3000 dev / 8501 prod)
streamlit/        Legacy Streamlit app (port 8501)
sync/             daily_sync.py + daily_summary.py (token refresh + Whoop pull)
shared/           shared SQLite store (whoop_data.db)
tokens.json       Whoop OAuth tokens (gitignored, repo root)
```

## Setup

```bash
cp .env.example .env                  # fill WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cd apps/web && npm install
```

Also set `ANTHROPIC_API_KEY` in `.env` to enable the Coach.

## Run

```bash
# Next.js (active)
cd apps/web && npm run dev            # http://localhost:3000

# Streamlit (legacy)
streamlit run streamlit/app.py        # http://localhost:8501

# Manual sync
python sync/daily_sync.py
```

First run: open the dashboard, hit Connect to Whoop, complete OAuth. Tokens land in `tokens.json` at repo root.

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
| `/settings` | Manual sync trigger, token info |

## Coach (LLM tool-use)

`/api/chat` runs an agentic loop with Claude Sonnet 4.6. The model has 5 tools:

- `query_recovery(start_date, end_date)`
- `query_sleep(start_date, end_date)`
- `query_strain(start_date, end_date)`
- `query_workouts(start_date, end_date)`
- `query_journal(start_date, end_date)`

Conversations live in `chat_messages` keyed by `thread_id`. The model's `tool_use` and `tool_result` content blocks are persisted as JSON in the `blocks` column so multi-turn conversations preserve full tool context across reloads. Auto-titles via Haiku 4.5.

Caps: 8 tool-use iterations, 16K output tokens. On `max_tokens` stop reason, partial reply is returned with a truncation marker.

## Data flow

1. OAuth callback writes tokens to `tokens.json` (atomic tmp+rename, thread-safe refresh)
2. `daily_sync.py` (manual today; auto-sync not yet scheduled) pulls last 7 days from Whoop API in parallel (`ThreadPoolExecutor`, 5 workers) and upserts to SQLite
3. `compute_daily_summary` builds a denormalized per-day row in `daily_summary`
4. Web app reads from `shared/whoop_data.db` via `apps/web/src/lib/db.ts`
5. Coach tools query the same DB by date range

## Deploy

VM (Ubuntu): runs as `whoop-web.service` (systemd) on port 8501. Standard flow:

```bash
ssh ubuntu@<vm>
sudo -u george bash -c 'cd /home/george/Documents/whoop-dashboard && git pull origin main'
cd apps/web && npm ci && npm run build
sudo systemctl restart whoop-web
```

Public domain has an auth gate; localhost on the VM bypasses it for smoke tests.

## Conventions

- Only Whoop records with `score_state == "SCORED"` are processed
- Naps excluded from sleep aggregations (`WHERE nap = 0`)
- Whoop API base: `https://api.prod.whoop.com/developer`
- Schema migrations are lazy ALTER statements in `openWrite()` — idempotent, no manual migration step
- All chart units converted at the DataFrame layer (ms→hours, kJ→kcal)

## Environment

```
WHOOP_CLIENT_ID
WHOOP_CLIENT_SECRET
WHOOP_REDIRECT_URI       # default: http://localhost:8501 (Streamlit) or http://localhost:3000/api/auth/callback (Next.js)
ANTHROPIC_API_KEY
WHOOP_DB_PATH            # optional override for shared/whoop_data.db
```

## Status

Active development. Recent work: persistent chat threads, mobile bottom-nav, tool-use block preservation, max-tokens partial reply handling. See open issues for what's next.
