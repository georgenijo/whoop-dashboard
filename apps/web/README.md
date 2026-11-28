# apps/web/

Next.js 16 app for the Whoop+ dashboard rebuild (Phase 1).

Runs alongside the legacy Streamlit app (which lives in `streamlit/` and serves
on port 8501) during the migration window.

## Setup

```bash
cd apps/web
cp ../../.env.example .env.local   # fill in the variables needed for your flow
npm install
npm run dev                        # http://localhost:3000
```

See `../../docs/operations/environment-and-deploy.md` for the canonical
variable inventory and production configuration locations.

Set the Whoop developer app's redirect URI to
`http://localhost:3000/api/auth/callback` if you intend to run the OAuth flow
from this app instead of Streamlit.

## Data

`src/lib/db.ts` defaults to `../../shared/whoop_data.db` via `better-sqlite3`;
`WHOOP_DB_PATH` can override that default. Read-only dashboard queries use the
schema defined in `streamlit/whoop/db.py`, while app-owned tables such as chat,
settings, and sync logs are opened read-write. Deployments should not mount the
DB read-only, or those writes will fail. If the DB is missing or empty (e.g.
before the first Whoop sync), the Overview renders with muted empty states and
no runtime errors.

## Feature flags

- `RECOVERY_CALENDAR=1` — shows a **Recovery calendar** card on `/recovery`
  (below the overtraining card): a GitHub-style heatmap of the trailing 12
  months of daily recovery (53 week columns x 7 days, Monday-first per
  `WEEK_START_DAY`), each cell colored by the shared `recoveryBand`
  thresholds (High >=67, Mid 34–66, Low <34) with a hover tooltip (date,
  score, HRV, RHR). Below it: a text legend with per-band counts, the current
  and longest run of consecutive green days, best and worst month by average
  (months with at least 7 scored days), and days-scored coverage. The grid is
  `role="img"` with a one-sentence summary, backed by visually hidden monthly
  and daily data tables for screen readers. Built by
  `src/lib/analytics/recoveryCalendar.ts` from one extra user-scoped
  `getRecoveryRange` read over the 12-month window; no network or LLM calls,
  no client JS. Unset (default) or any other value: `/recovery` renders
  exactly as before and does no extra reads.

## Design tokens

- `src/app/theme.css` — verbatim copy of the Whoop+ design kit's
  `colors_and_type.css` (minus the Google Fonts `@import`, since Geist is
  loaded via `next/font/google` in `src/app/layout.tsx`). Kept byte-identical
  to the kit source so future kit refreshes diff cleanly.
- `src/app/globals.css` — aurora / glass / layout / card / chart styles
  ported from the kit's `ui_kits/dashboard/styles.css`.
