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

## Feature flag: `DAY_DETAIL=1` — Day detail page (`/day/[date]`)

Server-side env flag, off by default, read per request.

- **Off (default, any value other than `1`):** `/day` and `/day/<date>` return
  404 before any auth or DB read, and no link to them renders anywhere (the
  workout detail page's date stays plain text).
- **On:** `/day/YYYY-MM-DD` shows everything synced for that date: recovery
  (score + band, HRV, resting HR, respiratory rate, skin temp, SpO₂), the
  night's sleep (filed on its wake day — duration, bed/wake time,
  performance, efficiency, consistency, disturbances, need, stage split,
  naps), day strain (calories, avg/max HR), that day's workouts (each linking
  to `/workouts/<id>`), journal entries when the optional `journal` table has
  any, and a plain-language one-line recap. Previous/next-day buttons (next is
  disabled on today), a no-JS date picker (a GET form to `/day?date=…`)
  listing the last 365 days that have data, and a "no data for this day"
  state with links to the nearest earlier/later day with data. The date is
  validated strictly (`YYYY-MM-DD`, a real calendar date, not after today in
  the user's timezone); anything else 404s. The workout detail page's date
  becomes a link to its day.
- Reads go through the existing user-scoped readers only
  (`src/lib/day-detail.ts`); the model is pure
  (`src/lib/analytics/dayDetail.ts`). No tables, migrations, AI calls or
  network calls.
