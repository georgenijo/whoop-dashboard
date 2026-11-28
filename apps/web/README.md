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

### `SLEEP_PLAN=1` — "Tonight" sleep plan on `/sleep`

Off by default. Server-side env var, read on every request (restart
`whoop-web` after changing it in the service environment).

- **Off (unset or anything other than `1`)**: `/sleep` renders exactly as
  before and makes no extra DB reads.
- **On**: `/sleep` gains a "Tonight" card above the cumulative sleep-debt
  chart, with a recommended bedtime, a wind-down time 45 min earlier, the
  sleep that bedtime yields, a one-line reason, and a strip comparing the
  plan with your last 7 bedtimes. It costs two extra user-scoped reads
  (`getSleepRange` and `getRecoveryRange` over the last 30 days), runs no
  network or LLM calls, sends no notifications, and doesn't write anything.

The logic lives in `src/lib/analytics/sleepPlan.ts` (pure, unit-tested):

- wake time = circular median of the last 14 wake times
- sleep target = baseline need plus a payback of half the last 7 nights' sleep
  debt, capped at 1 h
- time in bed = sleep target ÷ typical efficiency
- the bedtime is corrected for a DST change overnight, using the server's time
  zone, the same assumption `localToday()` makes
- when your earlier nights went with higher recovery, the bedtime moves up to
  60 min earlier
- with fewer than 5 nights the card shows only a hint, and when wake times
  vary by more than about ±45 min (median absolute deviation) it calls the
  schedule irregular

## Design tokens

- `src/app/theme.css` — verbatim copy of the Whoop+ design kit's
  `colors_and_type.css` (minus the Google Fonts `@import`, since Geist is
  loaded via `next/font/google` in `src/app/layout.tsx`). Kept byte-identical
  to the kit source so future kit refreshes diff cleanly.
- `src/app/globals.css` — aurora / glass / layout / card / chart styles
  ported from the kit's `ui_kits/dashboard/styles.css`.
