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
- `RECOVERY_OUTLOOK=1` — shows a **Tomorrow's recovery outlook** card at the
  top of `/recovery`: a likely band for tomorrow's recovery (e.g. 55–72%)
  built only from the user's own last 90 days (independent of the range
  picker). Each past day is tagged with its night's sleep-need-met bucket
  (<70 / 70–84 / 85%+, Whoop's performance colours) and its prior day's
  strain bucket (<10 / 10–13.9 / 14+). The band is the 25th–75th percentile
  of recovery on past days matching tonight's assumed sleep (the user's usual
  bucket over the last 14 nights) × today's strain so far; with fewer than 5
  matching days it falls back to the sleep bucket alone, then to all days
  with a wider 10th–90th band. Also shown: the band for each sleep scenario,
  the two biggest levers (robust Theil–Sen slopes, e.g. "+1 h of sleep
  tonight — typically +6 pts for you"; only for changes inside the user's own
  observed range), the number of similar days, a low/medium/high confidence
  label by sample size, and explicit "not a prediction of Whoop's score"
  wording. Fewer than 14 scored days shows "not enough data". Pure
  computation in `src/lib/analytics/recoveryOutlook.ts` (thresholds are named
  constants there); three extra user-scoped reads (`getRecoveryRange`,
  `getSleepRange`, `getStrainRange`), no network or LLM calls. Unset
  (default) or any other value: `/recovery` renders exactly as before and
  does no extra reads.
- `RECOVERY_CALENDAR=1` — shows a **Recovery calendar** card on `/recovery`
  (below the overtraining card): a GitHub-style heatmap of the trailing 12
  months of daily recovery (53 week columns x 7 days, Monday-first per
  `WEEK_START_DAY`), each cell colored by the shared `recoveryBand`
  thresholds (High >=67, Mid 34–66, Low <34) with a hover tooltip (date,
  score, HRV, RHR). Below it: a text legend with per-band counts, the current
  and longest run of consecutive green days, best and worst month by average
  (months with at least 7 scored days), and days-scored coverage. The grid is
  `role="img"` with a one-sentence summary, backed by visually hidden monthly
  and daily data tables for screen readers. Built by
  `src/lib/analytics/recoveryCalendar.ts` from one extra user-scoped
  `getRecoveryRange` read over the 12-month window; no network or LLM calls,
  no client JS. Unset (default) or any other value: `/recovery` renders
  exactly as before and does no extra reads.
Server-side env flags, read at request time. Each is **off unless set to
exactly `1`**; when off, nothing new is reachable or rendered and no extra DB
reads run.

| Flag | Effect when `1` |
|---|---|
| `MORNING_BRIEF` | Adds a "Today" morning-brief card to the top of the Overview (`/`): readiness (recovery score, zone, vs the prior 7-day average), last night's sleep (hours vs need, performance, bed → wake), yesterday's strain and workouts, at most one "watch out" (illness signal from `lib/analytics/illness.ts`, else overtraining from `lib/analytics/ots.ts`), and one fixed-rule suggestion. Pure rules in `src/lib/analytics/morningBrief.ts`; reads via `readOverviewMorningBriefInputs` in `src/lib/db/morning-brief.ts` (existing user-scoped range readers, 30-day look-back). No AI, no network. If today's recovery is not scored yet it shows the latest scored day and says so; stale data shows the same "Last synced … · N days ago" banner as `/strain`. |
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

### `TRAINING_LOAD=1` — Training Load balance page (`/load`)

- **Off (default, any value other than `1`):** `/load` returns 404 before any
  auth or DB read, no Sidebar or BottomNav entry renders, and no other page
  changes.
- **On:** adds "Load" to the Sidebar's Dashboard group and the BottomNav
  "More" drawer. The page (server-rendered, no client JS) shows the
  acute:chronic workload ratio from daily Whoop strain: acute = mean daily
  strain over the last 7 calendar days, chronic = mean over the last 28,
  counting only days with strain data. Zones: undertrained < 0.8, sweet spot
  0.8–1.3, caution 1.3–1.5, high > 1.5 (constants in
  `src/lib/analytics/trainingLoad.ts`). It also shows a 12-week ratio chart
  with the zone bands, the projected ratio for tomorrow after a rest day
  (strain 4) or a hard day (strain 16), and a one-line suggestion. With fewer
  than 28 days of history it shows "building baseline"; a zero baseline shows
  no ratio. "Today" is the user's `user_settings.tz` date. Reads go through
  the existing user-scoped `getStrainRange`; the math is pure. No tables,
  migrations, LLM or network calls.

### `DATA_HEALTH=1` — Data health page (`/data-health`)

- **Off (default, any value other than `1`):** `/data-health` returns 404
  before any auth or DB read, no Sidebar or BottomNav entry renders, and no
  other page changes.
- **On:** adds "Data health" just above Logs in the Sidebar's Intelligence
  group and the BottomNav "More" drawer. The page (server-rendered, no client
  JS) shows how complete the user's data is over the last 30 or 90 days
  (`?window=30|90`, default 30):
  - a one-cell-per-day strip for recovery score, HRV, resting HR, respiratory
    rate, skin temperature, SpO2, sleep, day strain and workouts, with the
    coverage %, longest gap and gap count. Today counts as "pending" (not
    missing) until its data lands. Workouts are activity days, so a rest day
    is never "missing". A sensor that never reported in the window (often
    SpO2/skin temp) shows "Not recorded" instead of a red strip;
  - what the gaps affect, plus minimum-history checks for flag-gated
    features that are switched on (Training Load, sleep plan, recovery
    drivers, weekly review), using those modules' own exported constants;
  - duplicate/overlap warnings: two main sleeps on one date (charts keep the
    longest, the same rule as `SLEEP_DEDUP_WHERE`) and overlapping
    sleep/nap intervals;
  - the last successful and failed sync per source from `sync_logs`
    (token keepalive rows ignored).
  Days are the user's `user_settings.tz` calendar days (UTC fallback). Reads
  go through the existing user-scoped readers (`getRecoveryRange`,
  `getSleepRangeRaw`, `getNaps`, `getStrainRange`, `getWorkoutRowsRange`,
  `getSyncLogs`, 120 days); the logic is pure in
  `src/lib/analytics/dataHealth.ts`. No tables, migrations, LLM or network
  calls.

### `SHARE_CARD=1` — Shareable daily snapshot card (`/share/today`)

- **Off (default, any value other than `1`):** `/share/today` and
  `/api/share/today` return 404 before any auth or DB read, no Sidebar or
  BottomNav entry renders, and no other page changes.
- **On:** adds "Share today" as the last item in the Sidebar's main group and
  the first item in the BottomNav "More" drawer. The page (server-rendered, no
  client JS) shows a 4:5 card meant to be screenshotted: recovery (ring + Whoop
  band), sleep (time asleep + Whoop performance band), strain so far (+ Whoop
  strain category and workout count), HRV and resting HR (each compared with
  the user's own median over the 30 days before the card's day; at least 7
  readings, ±5% reads as "Usual"), and a one-line recap. If today has nothing
  synced yet, the card shows yesterday, labelled "Yesterday".
  - `?hide=1` hides every number (bands and colours only; workout count
    becomes "a workout"/"workouts"); `?theme=light` picks the light theme
    (dark is the default). Both are plain links on the page.
  - "Download PNG" fetches `/api/share/today` with the same options: a
    1080 x 1350 PNG rendered by `next/og` `ImageResponse` from the same JSX
    tree as the page, sent `Content-Disposition: attachment` with
    `Cache-Control: no-store, private`.
  - Privacy: both routes need the normal signed-in session (the page
    redirects to `/signin`, the image route returns 401) and only ever read
    the session user's own rows. There are no share links, tokens or public
    URLs. The card carries no name, email, ids, sport names or journal text;
    every string is generated ASCII, so the PNG uses `next/og`'s bundled font
    and never fetches a fallback font or emoji glyph.
  Reads go through the existing user-scoped readers (`getRecoveryRange` for
  32 days, `getSleepRange`, `getStrainRange`, `getWorkoutRowsRange` for today
  and yesterday) in the user's tz (`getInsightTimezone`, UTC fallback). The
  per-day shaping reuses the Day detail model (`buildDayDetail`), so the
  numbers match `/day/[date]`; the card model is pure in
  `src/lib/share/todayCard.ts`. No tables, migrations, dependencies, LLM or
  network calls.

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
### `PERIOD_COMPARE=1` — Compare periods (`/compare`)

Off by default. With the flag unset (or any value other than exactly `1`),
`/compare` returns 404 before any auth lookup or data read in the page, the
Sidebar and mobile "More" drawer show no Compare entry, and nothing else
changes visually.

With `PERIOD_COMPARE=1` in the server environment, a **Compare** nav entry
appears and `/compare` shows two date ranges side by side: average and change
for recovery, HRV, resting HR, sleep duration / performance / consistency, day
strain, and workouts and workout minutes (as per-week rates), each with a
direction-aware arrow, a per-metric "about the same" noise band, and a paired
daily sparkline.

- Presets: `?preset=month` (month-to-date vs last month), `?preset=30d`
  (default; last 30 days vs the 30 before), `?preset=year` (year-to-date vs
  the same dates last year).
- Custom: `?a_from=YYYY-MM-DD&a_to=…&b_from=…&b_to=…` via the plain GET form.
  Reversed ends are swapped, future ends are clamped to today, spans longer
  than 400 days are shortened to the most recent 400, and an invalid or
  wholly-future range falls back to the preset with an error shown.
- Pure logic lives in `src/lib/analytics/comparePeriods.ts`; reads use the
  existing user-scoped `get*Range` readers. No new tables, network calls, or
  client JavaScript.
Server-side environment flags. Each one is **off unless set to exactly `1`**;
with the flag off the feature is unreachable, renders nothing, and does no
extra DB reads.

| Flag | Enables |
|---|---|
| `YEAR_REVIEW=1` | **Year in Review** at `/year` (`?y=YYYY`, defaults to the current year in the user's timezone; out-of-range or malformed years fall back to it) plus a "Year in review →" link on `/stats`. A printable annual summary: days scored, yearly and per-month averages (recovery, HRV, RHR, sleep), best/toughest month, longest green-recovery streak, highest-strain day, workout totals with HR-zone minutes and top sports, sleep-consistency trend, personal bests, and 3–5 deterministic highlight sentences. Pure computation in `src/lib/analytics/yearReview.ts` over the existing user-scoped range readers, bounded to one calendar year. Flag off → `/year` is a 404 and the Stats link is absent. |
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
### `HEALTH_REPORT=1` — printable health summary (`/report`)

(`src/lib/health-report-flag.ts`); only the exact value `1` enables it.

- **Off (unset or any other value):** `/report` renders Next's not-found page
- **On:** adds "Health report" to the Sidebar's Intelligence group and the
  BottomNav "More" drawer. The page summarizes the last 7, 30 (default) or 90
  days (`?days=`, validated against that allowlist; anything else falls back to
  30) for sharing with a coach or clinician: average, min and max (with dates)
  of recovery, HRV, resting HR, sleep duration (light + deep + REM, main sleep
  only), sleep efficiency and performance, day strain, respiratory rate, and
  skin temperature when Whoop recorded it (plus the largest deviation from the
  period's own mean); workout count and total time; best/worst recovery and
  longest sleep; and data coverage (`27/30 days scored recovery`).
- **Print:** "Print / Save as PDF" calls `window.print()`. `@media print`
  styles (`src/styles/report.css`, imported only by this page) hide the app
  chrome and the period picker, print black on white, and avoid breaking
  sections and table rows across pages.
- No CSV link: there is no CSV export on `main` to reuse yet.
  `getStrainRange`, and `getWorkoutRowsRange` readers; the logic is in
  `src/lib/analytics/healthReport.ts`, which is pure.

To enable it in production, add `Environment=HEALTH_REPORT=1` to the
Server-side env flags, read at request time. Default OFF; only the exact value
`1` enables a flag.

| `COMMAND_PALETTE=1` | Cmd/Ctrl-K quick-jump palette plus a search button in the desktop header. You can fuzzy-search the nav pages and quick actions ("Go to today", "Show last 30 days", …) or type a date (`2026-11-02`, `yesterday`, `last monday`, `nov 2`). A date opens a dashboard page at the smallest `?range=` window that contains it. Navigation only: no network calls, no data reads. With the flag off, the dashboard layout never references the component, so no JS ships and no key listener or button appears. Logic: `src/lib/ui/palette.ts`; UI: `src/components/chrome/CommandPalette.tsx`. |
## Feature flag: `DAY_DETAIL=1` — Day detail page (`/day/[date]`)

Server-side env flag, off by default, read per request.

- **Off (default, any value other than `1`):** `/day` and `/day/<date>` return
  404 before any auth or DB read, and no link to them renders anywhere (the
  workout detail page's date stays plain text).
- **On:** `/day/YYYY-MM-DD` shows everything synced for that date: recovery
  (score + band, HRV, resting HR, respiratory rate, skin temp, SpO₂), the
  night's sleep (filed on its wake day — duration, bed/wake time,
  performance, efficiency, consistency, disturbances, need, stage split,
  naps), day strain (calories, avg/max HR), that day's workouts (each linking
  to `/workouts/<id>`), journal entries when the optional `journal` table has
  any, and a plain-language one-line recap. Previous/next-day buttons (next is
  disabled on today), a no-JS date picker (a GET form to `/day?date=…`)
  listing the last 365 days that have data, and a "no data for this day"
  state with links to the nearest earlier/later day with data. The date is
  validated strictly (`YYYY-MM-DD`, a real calendar date, not after today in
  the user's timezone); anything else 404s. The workout detail page's date
  becomes a link to its day.
- Reads go through the existing user-scoped readers only
  (`src/lib/day-detail.ts`); the model is pure
  (`src/lib/analytics/dayDetail.ts`). No tables, migrations, AI calls or
  network calls.
