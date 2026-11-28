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

## Design tokens

- `src/app/theme.css` — verbatim copy of the Whoop+ design kit's
  `colors_and_type.css` (minus the Google Fonts `@import`, since Geist is
  loaded via `next/font/google` in `src/app/layout.tsx`). Kept byte-identical
  to the kit source so future kit refreshes diff cleanly.
- `src/app/globals.css` — aurora / glass / layout / card / chart styles
  ported from the kit's `ui_kits/dashboard/styles.css`.

## Feature flags

### `HEALTH_REPORT=1` — printable health summary (`/report`)

Off by default. Server-side env flag, read per request
(`src/lib/health-report-flag.ts`); only the exact value `1` enables it.

- **Off (unset or any other value):** `/report` renders Next's not-found page
  before any auth or DB read, no Sidebar or BottomNav entry is rendered, and no
  other page changes.
- **On:** adds "Health report" to the Sidebar's Intelligence group and the
  BottomNav "More" drawer. The page summarizes the last 7, 30 (default) or 90
  days (`?days=`, validated against that allowlist; anything else falls back to
  30) for sharing with a coach or clinician: average, min and max (with dates)
  of recovery, HRV, resting HR, sleep duration (light + deep + REM, main sleep
  only), sleep efficiency and performance, day strain, respiratory rate, and
  skin temperature when Whoop recorded it (plus the largest deviation from the
  period's own mean); workout count and total time; best/worst recovery and
  longest sleep; and data coverage (`27/30 days scored recovery`).
- **Print:** "Print / Save as PDF" calls `window.print()`. `@media print`
  styles (`src/styles/report.css`, imported only by this page) hide the app
  chrome and the period picker, print black on white, and avoid breaking
  sections and table rows across pages.
- No CSV link: there is no CSV export on `main` to reuse yet.
- No new tables, migrations, dependencies, network calls, or LLM calls. It
  reads through the existing user-scoped `getRecoveryRange`, `getSleepRange`,
  `getStrainRange`, and `getWorkoutRowsRange` readers; the logic is in
  `src/lib/analytics/healthReport.ts`, which is pure.

To enable it in production, add `Environment=HEALTH_REPORT=1` to the
`whoop-web` systemd drop-in and restart the service. That is an operator
action; this change does not enable it anywhere.
