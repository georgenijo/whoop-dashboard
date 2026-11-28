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

- `RECOVERY_DRIVERS=1` — shows a **What moves your recovery** card near the
  top of `/recovery`: the user's own habits ranked by how strongly they line
  up with their recovery score over the last 120 days (independent of the
  range picker). Drivers: previous night's sleep duration, bedtime regularity
  (minutes from the user's median bedtime), previous day's strain, workout vs
  rest day, deep-sleep share, and weekend vs weekday. Each gets a plain-terms
  effect (top vs bottom third, or yes vs no), a Pearson/point-biserial r with
  a weak/moderate/strong label, and its sample size. A driver is only shown
  as a finding when it has ≥21 days, ≥5 days per compared group, |r| ≥ 0.2,
  t ≥ 2 (≈ p < 0.05), a gap of ≥3 recovery points, and a sign that agrees
  with r; everything else reads "not enough data" or "no clear pattern". Top
  3 are ranked with a bar; fewer than 21 scored recovery days shows an empty
  state. Labelled as association, not causation. Pure computation in
  `src/lib/analytics/recoveryDrivers.ts` (thresholds are named constants
  there); four extra user-scoped reads (`getRecoveryRange`, `getSleepRange`,
  `getStrainRange`, `getWorkoutRowsRange`), no network or LLM calls. Unset
  (default) or any other value: `/recovery` renders exactly as before and
  does no extra reads.

## Design tokens

- `src/app/theme.css` — verbatim copy of the Whoop+ design kit's
  `colors_and_type.css` (minus the Google Fonts `@import`, since Geist is
  loaded via `next/font/google` in `src/app/layout.tsx`). Kept byte-identical
  to the kit source so future kit refreshes diff cleanly.
- `src/app/globals.css` — aurora / glass / layout / card / chart styles
  ported from the kit's `ui_kits/dashboard/styles.css`.
