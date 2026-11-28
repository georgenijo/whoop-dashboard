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

Server-side env flags, read at request time. Default OFF; only the exact value
`1` enables a flag.

| Flag | Enables |
|---|---|
| `COMMAND_PALETTE=1` | Cmd/Ctrl-K quick-jump palette plus a search button in the desktop header. You can fuzzy-search the nav pages and quick actions ("Go to today", "Show last 30 days", …) or type a date (`2026-11-02`, `yesterday`, `last monday`, `nov 2`). A date opens a dashboard page at the smallest `?range=` window that contains it. Navigation only: no network calls, no data reads. With the flag off, the dashboard layout never references the component, so no JS ships and no key listener or button appears. Logic: `src/lib/ui/palette.ts`; UI: `src/components/chrome/CommandPalette.tsx`. |
