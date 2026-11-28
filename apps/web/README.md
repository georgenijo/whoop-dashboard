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

Server-side env flags, off by default, read per request.

### `TRAINING_LOAD=1` — Training Load balance page (`/load`)

- **Off (default, any value other than `1`):** `/load` returns 404 before any
  auth or DB read, no Sidebar or BottomNav entry renders, and no other page
  changes.
- **On:** adds "Load" to the Sidebar's Dashboard group and the BottomNav
  "More" drawer. The page (server-rendered, no client JS) shows the
  acute:chronic workload ratio from daily Whoop strain: acute = mean daily
  strain over the last 7 calendar days, chronic = mean over the last 28,
  counting only days with strain data. Zones: undertrained < 0.8, sweet spot
  0.8–1.3, caution 1.3–1.5, high > 1.5 (constants in
  `src/lib/analytics/trainingLoad.ts`). It also shows a 12-week ratio chart
  with the zone bands, the projected ratio for tomorrow after a rest day
  (strain 4) or a hard day (strain 16), and a one-line suggestion. With fewer
  than 28 days of history it shows "building baseline"; a zero baseline shows
  no ratio. "Today" is the user's `user_settings.tz` date. Reads go through
  the existing user-scoped `getStrainRange`; the math is pure. No tables,
  migrations, LLM or network calls.

## Design tokens

- `src/app/theme.css` — verbatim copy of the Whoop+ design kit's
  `colors_and_type.css` (minus the Google Fonts `@import`, since Geist is
  loaded via `next/font/google` in `src/app/layout.tsx`). Kept byte-identical
  to the kit source so future kit refreshes diff cleanly.
- `src/app/globals.css` — aurora / glass / layout / card / chart styles
  ported from the kit's `ui_kits/dashboard/styles.css`.
