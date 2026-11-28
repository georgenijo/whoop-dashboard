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

### `RECORDS_PAGE=1` — Personal Records page (`/records`)

- **Off (default, any value other than `1`):** `/records` returns 404 before
  any auth or DB read, no Sidebar or BottomNav entry renders, and no other
  page changes.
- **On:** adds "Records" to the Sidebar's Dashboard group and the BottomNav
  "More" drawer. The page is plain server-rendered markup (no client JS). For
  best HRV, lowest resting HR, best recovery, highest day strain, longest
  sleep (time asleep), best sleep performance, longest workout and most steps
  it shows the standing record and its date, how it compares with the median
  of the user's last 90 days, the previous three records it replaced, and the
  days since it was last set or matched — plus the existing streak records.
  Reads are the user's own rows only (`getRecordSeries` in
  `src/lib/db/prs.ts`); the history logic is pure
  (`src/lib/analytics/records.ts`). No tables, migrations or network calls.

## Design tokens

- `src/app/theme.css` — verbatim copy of the Whoop+ design kit's
  `colors_and_type.css` (minus the Google Fonts `@import`, since Geist is
  loaded via `next/font/google` in `src/app/layout.tsx`). Kept byte-identical
  to the kit source so future kit refreshes diff cleanly.
- `src/app/globals.css` — aurora / glass / layout / card / chart styles
  ported from the kit's `ui_kits/dashboard/styles.css`.
