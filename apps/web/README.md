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
- `DATA_EXPORT=1` — enables `GET /api/export` and the "Export my data" card on
  `/settings` (CSV/JSON download of the signed-in user's own data). Off by
  default: the route 404s and the settings page is unchanged. See
  `../../docs/data-export.md`.
### `SLEEP_PLAN=1` — "Tonight" sleep plan on `/sleep`

Off by default. Server-side env var, read on every request (restart
`whoop-web` after changing it in the service environment).

- **Off (unset or anything other than `1`)**: `/sleep` renders exactly as
  before and makes no extra DB reads.
- **On**: `/sleep` gains a "Tonight" card above the cumulative sleep-debt
  chart, with a recommended bedtime, a wind-down time 45 min earlier, the
  sleep that bedtime yields, a one-line reason, and a strip comparing the
  plan with your last 7 bedtimes. It costs two extra user-scoped reads
  (`getSleepRange` and `getRecoveryRange` over the last 30 days), runs no
  network or LLM calls, sends no notifications, and doesn't write anything.

The logic lives in `src/lib/analytics/sleepPlan.ts` (pure, unit-tested):

- wake time = circular median of the last 14 wake times
- sleep target = baseline need plus a payback of half the last 7 nights' sleep
  debt, capped at 1 h
- time in bed = sleep target ÷ typical efficiency
- the bedtime is corrected for a DST change overnight, using the server's time
  zone, the same assumption `localToday()` makes
- when your earlier nights went with higher recovery, the bedtime moves up to
  60 min earlier
- with fewer than 5 nights the card shows only a hint, and when wake times
  vary by more than about ±45 min (median absolute deviation) it calls the
  schedule irregular
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

## Feature flags

### `WEEKLY_REVIEW=1` — Weekly Review page (`/weekly`)

Off by default. Server-side env flag, read per request (`src/lib/weekly-flag.ts`);
only the exact value `1` enables it.

- **Off (unset or any other value):** `/weekly` renders Next's not-found page
  before any auth or DB read, no Sidebar or BottomNav entry is rendered, and no
  other page changes.
- **On:** adds "Weekly review" to the Sidebar's Intelligence group and the
  BottomNav "More" drawer. The page compares the last 7 days (today plus the 6
  dates before, server-local date) with the 7 days before that: average
  recovery, HRV, resting HR, sleep duration, sleep performance and efficiency,
  and day strain, plus best/worst recovery day, nights under 7 h, bed/wake
  spread (the Sleep page's `computeBedtimePatterns`, needs 5+ nights), and
  workout count, time, and zone-2 minutes. It also shows 2–4 rule-based
  highlights (no AI).
- **Noise thresholds:** changes smaller than recovery 5 pts, HRV 3 ms, RHR
  2 bpm, sleep 20 min, sleep performance 3 pts, efficiency 2 pts, or strain 1.0
  read as "no real change". Week-over-week deltas need at least 4 scored
  recovery days in each week, and at least 4 values per metric. Otherwise only
  the current week is shown.
- **Print:** the page has a Print button, and `@media print` styles
  (`src/styles/weekly.css`) hide the app chrome and print black on white.
- No new tables, migrations, dependencies, network calls, or LLM calls. It
  reads through the existing user-scoped `getRecoveryRange`, `getSleepRange`,
  `getStrainRange`, and `getWorkoutRowsRange` readers. All of the logic is in
  `src/lib/analytics/weekly.ts`, which is pure.

To enable it in production, add `Environment=WEEKLY_REVIEW=1` to the
`whoop-web` systemd drop-in and restart the service. That is an operator
action; this change does not enable it anywhere.
