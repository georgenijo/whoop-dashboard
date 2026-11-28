# Data export (`DATA_EXPORT=1`)

User-owned export of the signed-in user's own Whoop domain data as CSV or
JSON. **Off by default.**

## Flag

| `DATA_EXPORT` | Behaviour |
|---|---|
| unset / anything other than `1` | `GET /api/export` returns 404 before auth or any DB read; `/settings` renders exactly as before (no card, no extra markup). |
| `1` | Route is live; `/settings` shows an **Export my data** card below the existing sections. |

The flag is read per request (`src/lib/export/flag.ts`), so turning it on in
the service environment takes effect after a restart with no build change.

## Endpoint

`GET /api/export?kind=…&format=…&from=YYYY-MM-DD&to=YYYY-MM-DD`

- Auth: `requireAuth` (session cookie or Bearer JWT), like sibling routes.
- `kind`: `recovery` | `sleep` | `workouts` | `cycles` | `steps` | `all` (default `all`).
- `format`: `csv` (default) | `json`.
- `from` / `to`: inclusive, user-local dates. Default `to` = today in the
  user's timezone (settings tz → account tz → UTC); default `from` = 89 days
  before `to` (a 90-day window). Max span **400 days**; `from` must be on or
  before `to`. Blank values (an empty date input) count as absent.
- Per-dataset row cap 5000; overflow is truncated and reported via the
  `X-Export-Truncated: 1` header and `truncated: true` in JSON.
- Response: `Content-Disposition: attachment; filename="whoop-export-<kind>-<from>_to_<to>.<ext>"`,
  `Cache-Control: no-store, private`. Bad params → 400 JSON `{error, message}`.

## What is (and is never) included

Only rows for the authenticated user, read through the existing tenant-scoped
`@/lib/db` readers (`forUser(userId)`). Columns are an explicit allow-list
(`EXPORT_COLUMNS` in `src/lib/export/data-export.ts`); no `user_id`, row ids
(workout / sleep / cycle ids), raw Whoop JSON, tokens, integrations, API keys,
Coach chats, or logs can appear.

Column order (stable — new columns are only ever appended):

| dataset | columns |
|---|---|
| recovery | date, recovery_score, hrv, rhr, spo2, skin_temp |
| sleep | date, nap, start_local, end_local, in_bed_ms, light_ms, deep_ms, rem_ms, awake_ms, sleep_need_ms, performance, efficiency, consistency, disturbances, sleep_cycles, respiratory_rate |
| workouts | date, start_utc, end_utc, sport, duration_sec, strain, kilojoule, avg_hr, max_hr, distance_m, zone_0_ms … zone_5_ms |
| cycles | date, strain, kilojoule, avg_hr, max_hr |
| steps | date, steps, source |

`sleep_cycles` is the number of sleep cycles that night (named so it can't be
confused with the `cycles` strain dataset). Sleep includes every main sleep in range (not deduped to one per date) plus
naps (`nap=true`, `in_bed_ms` = nap duration). Rows are chronological.

## CSV

RFC 4180: comma-separated, CRLF line endings, header row, fields containing
`,` `"` CR or LF are quoted with `"` doubled. Empty cell = null. Dates are ISO
(`YYYY-MM-DD`; timestamps ISO 8601). No BOM.

Formula-injection protection: any **text** cell starting with `=` `+` `-` `@`
TAB or CR is prefixed with `'`. Numeric cells are emitted verbatim, so a real
negative number (e.g. `skin_temp` `-0.4`) stays numeric.

`kind=all` CSV is one table: a leading `dataset` column, then the union of all
dataset columns in the order above (blank where a dataset has no such column).

## JSON

```json
{
  "version": 1,
  "generated_at": "2026-11-27T21:00:00.000Z",
  "user_scope": "self",
  "kind": "recovery",
  "range": { "from": "2026-08-30", "to": "2026-11-27", "days": 90 },
  "truncated": false,
  "columns": ["date", "recovery_score", "hrv", "rhr", "spo2", "skin_temp"],
  "rows": [{ "date": "2026-08-30", "recovery_score": 71, "hrv": 62.5, "rhr": 51, "spo2": 96.1, "skin_temp": -0.4 }]
}
```

For `kind=all`, `columns` and `rows` are objects keyed by dataset
(`recovery`, `sleep`, `workouts`, `cycles`, `steps`).
