# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A personal health analytics dashboard that pulls data from the Whoop wearable API and displays recovery, sleep, strain, and workout metrics. The legacy UI is built with Python, Streamlit, and Plotly; the current web app is a Next.js App Router app.

## Commands

```bash
# Setup
cp .env.example .env          # then fill in WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Run
streamlit run streamlit/app.py   # serves on http://localhost:8501
cd apps/web && npm run dev       # serves on http://localhost:3000
```

No Python test suite or linter is configured. The web app build is `cd apps/web && npm run build`.

## Architecture

### Repo layout

The repo is split into discipline-specific subdirs so the legacy Streamlit app, the Next.js app, and the standalone sync job can live side-by-side:

- **`streamlit/`** — legacy Streamlit app (port 8501 during migration)
- **`apps/web/`** — Next.js 16 app and API server
- **`sync/`** — standalone daily sync job (`sync/daily_sync.py`)
- **`shared/`** — shared SQLite data store (`shared/whoop_data.db`)

`tokens.json` remains at the repo root. `shared/whoop_data.db` remains under `shared/` so the Streamlit app, Next.js app, and sync job share the same state.

### Module layout

- **`streamlit/app.py`** — Single-file Streamlit app: auth flow, data fetching, DataFrame construction, KPI metrics, and all Plotly charts. Uses `@st.fragment` to isolate chart sections and `@st.cache_data(ttl=600)` for a 10-minute fetch cache.
- **`streamlit/whoop/auth.py`** — OAuth2 flow against `api.prod.whoop.com`. Persists tokens to `tokens.json` (atomic write via tmp+rename). Thread-safe token refresh with `_refresh_lock`. Auto-refreshes tokens 60 seconds before expiry.
- **`streamlit/whoop/client.py`** — `WhoopClient` REST client wrapping the `/developer/v2` API. Handles pagination (`_get_all` with `nextToken`), raises `AuthError` (401) and `RateLimitError` (429). `fetch_all_parallel()` hits all 6 endpoints concurrently via `ThreadPoolExecutor(max_workers=5)`.
- **`sync/daily_sync.py`** — cron entry point for the daily sync. Adds repo-root `streamlit/` to `sys.path` so `from whoop.* import …` resolves.
- **`apps/web/src/lib/db.ts`** — Next.js SQLite access layer. Defaults to `../../shared/whoop_data.db` from `apps/web`, with `WHOOP_DB_PATH` override support.

### Data flow

1. OAuth callback → token stored in `st.session_state` + `tokens.json`
2. `fetch_all_parallel()` retrieves profile, body, cycles, recovery, sleep, workouts in parallel
3. `build_*_df()` functions filter to `SCORED` records, parse dates, convert units (ms→hours, kj→kcal), and produce pandas DataFrames
4. DataFrames drive KPI metrics (with day-over-day deltas) and Plotly charts

### Key conventions

- Only records with `score_state == "SCORED"` are processed; naps are excluded from sleep data
- Whoop API base: `https://api.prod.whoop.com/developer`
- Environment variables: `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `WHOOP_REDIRECT_URI` (defaults to `http://localhost:8501`)
- `tokens.json` at project root is the persistent token store (gitignored)
