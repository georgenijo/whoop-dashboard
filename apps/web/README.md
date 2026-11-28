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

Server-side env flags, read at request time. Each is **off unless set to
exactly `1`**; when off, nothing new is reachable or rendered and no extra DB
reads run.

| Flag | Effect when `1` |
|---|---|
| `MORNING_BRIEF` | Adds a "Today" morning-brief card to the top of the Overview (`/`): readiness (recovery score, zone, vs the prior 7-day average), last night's sleep (hours vs need, performance, bed → wake), yesterday's strain and workouts, at most one "watch out" (illness signal from `lib/analytics/illness.ts`, else overtraining from `lib/analytics/ots.ts`), and one fixed-rule suggestion. Pure rules in `src/lib/analytics/morningBrief.ts`; reads via `readOverviewMorningBriefInputs` in `src/lib/db/morning-brief.ts` (existing user-scoped range readers, 30-day look-back). No AI, no network. If today's recovery is not scored yet it shows the latest scored day and says so; stale data shows the same "Last synced … · N days ago" banner as `/strain`. |

## Design tokens

- `src/app/theme.css` — verbatim copy of the Whoop+ design kit's
  `colors_and_type.css` (minus the Google Fonts `@import`, since Geist is
  loaded via `next/font/google` in `src/app/layout.tsx`). Kept byte-identical
  to the kit source so future kit refreshes diff cleanly.
- `src/app/globals.css` — aurora / glass / layout / card / chart styles
  ported from the kit's `ui_kits/dashboard/styles.css`.
