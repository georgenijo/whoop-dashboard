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

### `HEALTH_ALERTS=1` — Health Alerts center (`/alerts`)

Off by default. Server-side env flag, read per request
(`src/lib/health-alerts-flag.ts`); only the exact value `1` enables it.

- **Off:** `/alerts` returns 404 before any auth or DB read, the Sidebar and
  the mobile More drawer show no Alerts entry, and the dashboard layout does no
  extra reads.
- **On:** adds "Alerts" to the Sidebar's Intelligence group (with a count badge
  for `watch`/`act` alerts; `info` never badges) and to the mobile More drawer.
  The page lists the signals the app already computes, most urgent first, each
  with severity (`info` / `watch` / `act`), a one-line explanation with the
  numbers, since-when, and what usually helps. With nothing current it shows
  "Nothing to flag" and the per-check status.

Rules live in `src/lib/analytics/healthAlerts.ts` (pure, no AI, no network) and
reuse the existing analytics so an alert never disagrees with its card:
illness signal (`illness.ts`), overtraining score (`ots.ts`), HRV below the
30-day 1.5σ band (`trends.ts`, same as `HRVTrend`), resting HR above the 14-day
baseline, skin-temp run (`skinTemp.ts`, shared with `SkinTempDeviationCard`),
respiratory rate outside ±2 br/min, Whoop's sleep-debt figure, and data
freshness. When the illness alert fires it absorbs the per-metric RHR / HRV /
skin-temp / resp alerts it is built from. Reads are the last 60 days through the
user-scoped `getRecoveryRange` / `getSleepRange` / `getStrainRange` plus
`getLastSuccessfulSyncAt`, deduped per request with `cache()`. Guidance only,
not medical advice.

To enable it in production, add `Environment=HEALTH_ALERTS=1` to the
`whoop-web` service drop-in and restart the service.
