# apps/web/

Next.js 16 app for the Whoop+ dashboard rebuild (Phase 1).

Runs alongside the legacy Streamlit app (which lives in `streamlit/` and serves
on port 8501) during the migration window.

## Setup

```bash
cd apps/web
cp .env.local.example .env.local   # fill in WHOOP_CLIENT_ID + WHOOP_CLIENT_SECRET
pnpm install
pnpm dev                           # http://localhost:3000
```

Set the Whoop developer app's redirect URI to
`http://localhost:3000/api/auth/callback` if you intend to run the OAuth flow
from this app instead of Streamlit.

## Data

`src/lib/db.ts` reads from `../../shared/whoop_data.db` via `better-sqlite3`
in read-only mode, using the schema defined in `streamlit/whoop/db.py`.
`WHOOP_DB_PATH` can override that default. If the DB is missing or empty
(e.g. before the first Whoop sync), the Overview renders with muted empty
states and no runtime errors.

## Design tokens

- `src/app/theme.css` — verbatim copy of the Whoop+ design kit's
  `colors_and_type.css` (minus the Google Fonts `@import`, since Geist is
  loaded via `next/font/google` in `src/app/layout.tsx`). Kept byte-identical
  to the kit source so future kit refreshes diff cleanly.
- `src/app/globals.css` — aurora / glass / layout / card / chart styles
  ported from the kit's `ui_kits/dashboard/styles.css`.
