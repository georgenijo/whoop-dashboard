# HealthKit Workout Enrichment — Data & API Contract

Shared contract for the HealthKit ingestion feature. iOS (T2), backend (T1), and the
web screens (T4/T5) all depend on this. **Do not diverge from it without updating this file.**

## Schema additions (`workouts` table)

Added via lazy ALTER in `apps/web/src/lib/db/connection.ts openWrite()`, gated by
`PRAGMA table_info` (existing pattern). `workouts` PK stays `id`.

| Column | Type | Meaning |
|---|---|---|
| `source` | TEXT | `'whoop'` (default, existing rows) or `'healthkit'` (backfilled rows with no Whoop parent) |
| `hr_series` | JSON | Downsampled per-second HR stream, or NULL when absent |

`hr_series` shape (downsampled to ≤ ~600 points, ~1 pt / 5–10s):
```json
{ "interval_sec": 5, "start_offset_sec": 0, "bpm": [105,112,118, ...] }
```
`bpm[i]` is the HR at `start_offset_sec + i*interval_sec` seconds into the workout.
Nulls allowed in the array for gaps. Keep raw arrays out of the row — downsample first.

## Ingest endpoint

`POST /api/ingest/healthkit` — auth via `requireAuth(req)` (Bearer, iOS session JWT).

Request body:
```json
{
  "workouts": [
    {
      "external_id": "HK-uuid",            // HealthKit workout UUID
      "sport": "soccer",
      "start": "2026-06-27T17:48:00.430Z", // ISO8601 UTC
      "end":   "2026-06-27T19:29:59.450Z",
      "source_name": "WHOOP",              // HK source app, informational
      "kilojoule": 4684.4,                 // optional
      "distance_m": null,                  // optional (Apple Watch workouts have it)
      "avg_hr": 149, "max_hr": 195,        // optional
      "hr_series": { "interval_sec": 5, "start_offset_sec": 0, "bpm": [/*…*/] }
    }
  ]
}
```

Response: `{ "matched": n, "inserted": n, "enriched": n, "skipped": n }`.

### Dedup / match rules (the hard part — implement carefully)
For each incoming workout, scoped to the authenticated `user_id`:
1. **Match** an existing row where `ABS(start - workouts.start) <= 60s` AND same/compatible sport.
   - Found → **enrich**: set `hr_series` (and `distance_m`/`avg_hr`/`max_hr` if the existing row is null). Do NOT overwrite Whoop's strain/kilojoule. Bump nothing else.
2. **No match** → **insert** a new row with `source='healthkit'`, deriving `duration_sec` from start/end, `date` via the same `parseDate` tz logic as `sync.ts`. Whoop-only fields (strain, zone_*_ms) stay NULL.
3. **Idempotent**: replaying the same payload must not duplicate. Use `external_id` stored on the row (add an `external_id` column too if needed) OR match-by-time + presence of `hr_series` to no-op.

Must remain compatible with the `scoped.ts` CI test — all reads through `forUser()`.

## Derived metrics (computed server-side from `hr_series`, shown on Screen A)

Marked "Estimated" in UI. Compute in `apps/web/src/lib/analytics/`:
- **Cardiac drift**: reuse existing `cardiacDrift` module. (HR÷effort, 1st vs 2nd half.)
- **Recovery rate**: bpm drop in the first 60s after the session's final sustained peak. Negative = good.
- **Time > 90% max**: seconds where bpm ≥ 0.9 × maxHR (maxHR from `body_measurements.max_heart_rate`, fallback 220−age or a constant).
- **TRIMP** (Banister): Σ over samples of `Δt(min) × HRr × 0.64·e^(1.92·HRr)` for men, where `HRr = (HR−rest)/(max−rest)`. rest from 30-day resting HR, max from profile.

All degrade gracefully: no `hr_series` → Screen A hides the HR card + Effort&Recovery, shows summary + zones only (see `workout-detail-no-stream.html`).
