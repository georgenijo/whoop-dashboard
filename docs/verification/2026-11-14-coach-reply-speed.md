# Coach reply speed — 2026-11-14

The user meant end-to-end Coach reply time, not SQL query execution. Local DB
reader baselines were already mostly below 1 ms, while a normal recovery/sleep
question spent two model calls selecting a read and then answering from it.

## Measured comparison

| Question | Before median | After median | Reduction | Model calls |
| --- | ---: | ---: | ---: | ---: |
| Recovery this week | 5.222 s | 4.028 s | 22.9% | 2 → 1 |
| Sleep last night | 5.653 s | 3.210 s | 43.2% | 2 → 1 |

These are client-observed POST-to-SSE-`done` times from **three independent new
threads per question per revision**, following an excluded warmup. Both sides
used Sonnet 5.5, Medium reasoning, the same prompts, the same private SQLite
source snapshot, and a warmed local production Next.js build on the same Mac.
The local HTTP hop is included; physical-iPhone/WAN transport is not measured.
External model/network variability is included. These are small-sample local
measurements, not a guarantee or a production percentile estimate.

All measured turns completed. Every baseline turn used two model calls; every
optimized turn used one. After-run recovery times were 3.608, 4.028, and 4.045 s;
sleep times were 3.210, 3.173, and **6.084 s**. The slow sleep outlier is retained;
the maximum was slightly worse than the baseline maximum of 6.068 s.

First streamed-text medians were almost unchanged (recovery 0.817 → 0.795 s,
sleep 0.852 → 0.854 s). Baseline early text was usually narration preceding
the tool call. Do not describe this as a universal first-token improvement.

Baseline source revision: `cea0ba2de2541383761d4b7d5752f7257b9e8ab2`.
Implementation: `6d8fd86` (code and regression tests). The final build also
completed a separate live smoke run after review fixes; those samples are not
mixed into the predefined three-run comparison.

## Change and scope

For an unambiguous supported first question about recent recovery, sleep,
strain, or workouts, the server runs the existing scoped read before inference
and supplies its bounded, nonempty output as a separate user-priority context
block. This removes the inference pass spent choosing that read. The original
user message stays verbatim; no model-generated tool transcript is fabricated.
The real read appears in the work log and logs as server-prefetched data.

The selected model, adaptive thinking, effort, output limit, and all ordinary
tools remain unchanged. Follow-ups, images, broad questions, explicit dates,
comparisons, arbitrary trailing instructions, and sync/plan requests retain
the normal path. Empty/error/oversized reads also fall back. Prefetch uses only
local read tools, not WHOOP refresh, steps, or plan writes. Missing-data
sync/re-query and cancellation remain available.

## Reproduce

Use separate disposable local databases backed up from one fixed source;
never copy a live SQLite file with `cp`, and never benchmark production. Keep
the selected user's model/effort/credentials identical. The script creates
real conversations and incurs ordinary provider usage on that local instance.

```sh
cd apps/web
npm run build
WHOOP_DB_PATH=/absolute/path/to/disposable.db PORT=3010 npm run start
```

In another terminal at the repository root:

```sh
python3 scripts/bench-coach-replies.py \
  --db /absolute/path/to/disposable.db --port 3010 --user-id 2 \
  --model claude-sonnet-5-5 --effort medium --runs 3 \
  --out /tmp/coach-replies.json
```

The harness uses the same local signing key, validates the logged model and
effort, and requires a newly written matching chat log in the supplied DB.
It outputs timing/usage metadata without replies or credentials. Run baseline
and changed revisions serially with no build/test jobs competing for CPU.

## Verification

- 1,329 tests in 132 files passed, including explicit data-access opt-outs,
  scoped query parameters, empty wrapped workout results, empty-read sync and
  re-query, cancellation, history integrity, and unchanged model/effort.
- Lint, TypeScript/production build, and `git diff --check` passed.
- Independent high-effort `gpt-6.1-sol` review completed; both P2 findings fixed
  with regression tests. No unreviewed product behavior was added afterward.
- Live baseline/repeat and a separate final-build smoke completed. No
  internal server/prefetch implementation wording appeared in measured replies.
- Production deployment was not performed as part of this measurement.
