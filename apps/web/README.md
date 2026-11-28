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

Server-side environment flags. Each one is **off unless set to exactly `1`**;
with the flag off the feature is unreachable, renders nothing, and does no
extra DB reads.

| Flag | Enables |
|---|---|
| `YEAR_REVIEW=1` | **Year in Review** at `/year` (`?y=YYYY`, defaults to the current year in the user's timezone; out-of-range or malformed years fall back to it) plus a "Year in review →" link on `/stats`. A printable annual summary: days scored, yearly and per-month averages (recovery, HRV, RHR, sleep), best/toughest month, longest green-recovery streak, highest-strain day, workout totals with HR-zone minutes and top sports, sleep-consistency trend, personal bests, and 3–5 deterministic highlight sentences. Pure computation in `src/lib/analytics/yearReview.ts` over the existing user-scoped range readers, bounded to one calendar year. Flag off → `/year` is a 404 and the Stats link is absent. |
