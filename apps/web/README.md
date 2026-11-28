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

Server-side env flags; anything other than the exact value `1` is off.

- `SIMILAR_WORKOUTS=1` — "Compared with similar sessions" card on
  `/workouts/[id]`: this session vs your previous (up to 5) sessions of the
  same sport within ±25% of its duration — avg/max HR, strain, distance, pace
  and Z0–2 / Z3 / Z4–5 zone mix with deltas, plus a plain-language verdict
  ("Higher intensity than usual", "Longest running this month"). Costs one
  extra bounded, user-scoped read (`getSimilarWorkoutCandidates`, past year
  through the end of the session's month, ≤250 rows). Also adds a small
  "vs usual" chip to the `/workouts` table, computed from the rows that page
  already loads (no extra query; comparisons only see the selected range).
  Off: no extra reads, no card, no chip, identical markup. Logic lives in
  `src/lib/analytics/similarWorkouts.ts`.

## Design tokens

- `src/app/theme.css` — verbatim copy of the Whoop+ design kit's
  `colors_and_type.css` (minus the Google Fonts `@import`, since Geist is
  loaded via `next/font/google` in `src/app/layout.tsx`). Kept byte-identical
  to the kit source so future kit refreshes diff cleanly.
- `src/app/globals.css` — aurora / glass / layout / card / chart styles
  ported from the kit's `ui_kits/dashboard/styles.css`.
