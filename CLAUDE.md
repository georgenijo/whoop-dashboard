# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A personal health analytics dashboard that pulls data from the Whoop wearable API and displays recovery, sleep, strain, and workout metrics. Built with Python, Streamlit, and Plotly.

## Commands

```bash
# Setup
cp .env.example .env          # then fill in WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Run
streamlit run app.py           # serves on http://localhost:8501
```

No test suite, linter, or build step is configured.

## Architecture

### Module layout

- **`app.py`** — Single-file Streamlit app: auth flow, data fetching, DataFrame construction, KPI metrics, and all Plotly charts. Uses `@st.fragment` to isolate chart sections and `@st.cache_data(ttl=600)` for a 10-minute fetch cache.
- **`whoop/auth.py`** — OAuth2 flow against `api.prod.whoop.com`. Persists tokens to `tokens.json` (atomic write via tmp+rename). Thread-safe token refresh with `_refresh_lock`. Auto-refreshes tokens 60 seconds before expiry.
- **`whoop/client.py`** — `WhoopClient` REST client wrapping the `/developer/v2` API. Handles pagination (`_get_all` with `nextToken`), raises `AuthError` (401) and `RateLimitError` (429). `fetch_all_parallel()` hits all 6 endpoints concurrently via `ThreadPoolExecutor(max_workers=5)`.

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

## Roadmap

The project is actively evolving beyond a stateless dashboard:

1. **Database layer** — Adding persistent storage so Whoop data is accumulated over time rather than fetched live each session
2. **LLM insights layer** — Adding an AI/cloud layer that analyzes stored data to surface patterns, trends, and natural-language health insights
