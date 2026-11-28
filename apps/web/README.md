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

- `STRAIN_TARGET=1` — shows a **Today's strain target** card on `/strain`
  (above the Today tiles and charts): a recommended day-strain range on
  Whoop's 0–21 scale, a bar of today's strain so far against it, and a
  one-line reason. Computed in `src/lib/analytics/strainTarget.ts` from
  today's recovery band (falls back to the latest scored day up to 3 days
  back, and says so), the 7-day average strain, training-stress balance
  (the same CTL/ATL EWMA as the TSB chart), and capped by the existing
  illness (`illness.ts`) and overtraining (`ots.ts`) signals. Thresholds are
  named, documented constants in that file. Pure computation: no network or
  LLM calls; the only extra read is 28 days of the user's recovery rows via
  `getRecoveryRange`. Unset (default) or any other value: `/strain` renders
  exactly as before and does no extra reads. Guidance only, not medical
  advice — the card says so.

## Design tokens

- `src/app/theme.css` — verbatim copy of the Whoop+ design kit's
  `colors_and_type.css` (minus the Google Fonts `@import`, since Geist is
  loaded via `next/font/google` in `src/app/layout.tsx`). Kept byte-identical
  to the kit source so future kit refreshes diff cleanly.
- `src/app/globals.css` — aurora / glass / layout / card / chart styles
  ported from the kit's `ui_kits/dashboard/styles.css`.
