# Plans contract (web + iOS)

Single source of truth for the Plans surface data shape. Both the Next.js web app
and the iOS Coach app consume `GET /api/plans` and must agree on this contract.

The Coach authors plans by calling the `save_workout_plan` write tool; they persist
to the user-scoped `workout_plans` table and surface here.

## TypeScript types

```ts
type Intensity = "hard" | "moderate" | "reduced" | "rest";

interface PlanExercise {
  name: string;   // "Barbell Bench Press"
  scheme: string; // "4 × 5"
  note?: string;  // optional cue, e.g. "↓load"
}

interface PlanDay {
  name: string;        // "Push"
  focus?: string;      // "Chest · Shoulders · Triceps"
  intensity: Intensity;
  exercises: PlanExercise[];
}

interface PlanStructure {
  days: PlanDay[];
  why?: string; // Coach's rationale, tied to recovery / HRV trend
}

interface WorkoutPlan {
  id: number;
  title: string;
  tag?: string;
  description?: string;
  created_by: "coach" | "user";
  is_active: boolean;
  plan: PlanStructure;
  recovery_context?: {
    recovery_score?: number; // today's recovery score when the plan was authored
    hrv_trend_pct?: number;  // signed % change in HRV trend
    note?: string;
  };
  created_at: string; // ISO-8601 UTC
  updated_at: string; // ISO-8601 UTC
}
```

## API

### `GET /api/plans`

Auth: `requireAuth` (Bearer → Cookie → 401). Serves both web and iOS.

Response `200`:

```ts
{
  plans: WorkoutPlan[];
  // OPTIONAL block — older clients ignore it; iOS decodes defensively.
  recovery?: {
    // The most recent available recovery day (today's row when scored, else
    // the latest scored day in the 7-day window). null when no scored day.
    today: {
      date: string;          // YYYY-MM-DD
      recovery_score: number; // 0–100
      band: "high" | "mid" | "low"; // high ≥67, mid 34–66, low <34
    } | null;
    // Last 7 days of REAL recovery scores, ascending by date. May be < 7
    // entries when data is sparse; days without a scored recovery are omitted.
    week: { date: string; recovery_score: number }[];
  };
}
```

Ordering: **active plan(s) first, then `updated_at` descending.**

`recovery` is derived from the same shared helper that backs the `/plans` page
(today's readiness banner + the 7-day readiness strip), so the web page and the
iOS Plans tab can never drift. The whole `recovery` block — and `recovery.today`
within it — is OPTIONAL/nullable: treat both as absent-safe when decoding.

## JSON example

```json
{
  "plans": [
    {
      "id": 12,
      "title": "Push / Pull / Legs",
      "tag": "Recovery-tuned",
      "description": "6-day hypertrophy split that auto-scales load to daily recovery.",
      "created_by": "coach",
      "is_active": true,
      "plan": {
        "days": [
          {
            "name": "Push",
            "focus": "Chest · Shoulders · Triceps",
            "intensity": "hard",
            "exercises": [
              { "name": "Barbell Bench Press", "scheme": "4 × 5" },
              { "name": "Incline DB Press", "scheme": "3 × 8" },
              { "name": "Overhead Press", "scheme": "4 × 6" }
            ]
          },
          {
            "name": "Pull",
            "focus": "Back · Biceps · Rear delts",
            "intensity": "moderate",
            "exercises": [
              { "name": "Weighted Pull-up", "scheme": "4 × 6" },
              { "name": "Barbell Row", "scheme": "3 × 8" }
            ]
          },
          {
            "name": "Legs",
            "focus": "Quads · Hamstrings · Calves",
            "intensity": "reduced",
            "exercises": [
              { "name": "Back Squat", "scheme": "3 × 5", "note": "↓load" },
              { "name": "Romanian Deadlift", "scheme": "3 × 8" }
            ]
          }
        ],
        "why": "30-day HRV trend is up +8% so push/pull volume was bumped a set each; leg load is pulled back this week after a strain spike."
      },
      "recovery_context": {
        "recovery_score": 62,
        "hrv_trend_pct": 8,
        "note": "Authored on a mid-recovery morning."
      },
      "created_at": "2026-06-21T14:02:11.000Z",
      "updated_at": "2026-06-21T14:02:11.000Z"
    }
  ],
  "recovery": {
    "today": { "date": "2026-06-21", "recovery_score": 62, "band": "mid" },
    "week": [
      { "date": "2026-06-15", "recovery_score": 71 },
      { "date": "2026-06-16", "recovery_score": 58 },
      { "date": "2026-06-17", "recovery_score": 44 },
      { "date": "2026-06-18", "recovery_score": 80 },
      { "date": "2026-06-19", "recovery_score": 66 },
      { "date": "2026-06-20", "recovery_score": 51 },
      { "date": "2026-06-21", "recovery_score": 62 }
    ]
  }
}
```

## `save_workout_plan` tool input (Coach write tool)

The Coach calls this to author a plan. Input schema (Anthropic strict tool):

```ts
{
  title: string;          // required
  tag?: string;
  description?: string;
  why?: string;           // becomes plan.why
  make_active?: boolean;  // when true, deactivates the user's other plans
  days: Array<{           // required, >= 1
    name: string;         // required
    focus?: string;
    intensity: "hard" | "moderate" | "reduced" | "rest"; // required
    exercises: Array<{    // required, >= 1
      name: string;       // required
      scheme: string;     // required
      note?: string;
    }>;
  }>;
}
```

The tool returns the stored `WorkoutPlan` (same shape as the API rows). On a repeated
identical submission within the same chat turn it returns the already-saved plan plus
`{ deduped: true }` instead of inserting a duplicate.

## Notes

- `recovery_context` is a snapshot captured at authoring time, not recomputed.
- The mock's per-plan "recovery fit %" is **decorative** — it is NOT stored. Web derives
  a band from today's recovery at render time; iOS may omit it.
- Per-exercise check-off / "finish session" persistence is **out of scope** in v1; the
  today's-session view renders read-only.
