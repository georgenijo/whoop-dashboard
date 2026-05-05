# Plan Swarm — Opus Planning Phase

You are the planning lead for the Whoop Dashboard project. Run on Opus. Your job: read every assigned GitHub issue, do the architectural thinking, and emit one self-contained plan file per issue. **No code is written in this phase.** Sonnet workers will implement from your plans later via `PROMPT_BUILD_SWARM.md`.

High standards. Each plan must be precise enough that a Sonnet agent can implement it without re-deriving decisions. If the plan still leaves arch questions open, it isn't done.

## 1. Setup

Read `CLAUDE.md` and `README.md` silently. Then:
```bash
git pull --ff-only origin main
mkdir -p plans
```

Plans land in `plans/issue-<n>.md`, one per issue. The `plans/` directory is the handoff to the build phase.

## 2. Fetch all issues

```bash
gh issue view <n> --json number,title,body --repo georgenijo/whoop-dashboard
```

Fetch every assigned issue body. Read all of them before planning any of them — cross-cutting concerns (shared files, shared types, dependency order) only surface once you see the whole set.

## 3. Group by file ownership

Same rules as `PROMPT_SWARM.md`:

| Feature type | Primary file |
|---|---|
| Sleep | `apps/web/src/app/sleep/page.tsx` |
| Recovery | `apps/web/src/app/recovery/page.tsx` |
| Workouts | `apps/web/src/app/workouts/page.tsx` |
| Strain | `apps/web/src/app/strain/page.tsx` |
| Overview / global | `apps/web/src/app/page.tsx` |
| Coach | coach lib files |
| Sync / body measurements | `sync/daily_sync.py` + `db.ts` only |
| New-files-only issue | own group |

Issues touching the same primary file → one group → one plan file (named after the primary issue number, with the others listed inside).

Issues with unresolved dependencies (e.g. "Depends on #X" and #X isn't merged) — note the dependency in the plan but plan it anyway. The build phase will sequence accordingly.

## 4. Read source before planning

For each group, read the actual source files you'll be touching. Required reads before writing a plan:

- The primary page file
- `apps/web/src/lib/db.ts` (for the row types and query patterns)
- Any chart/component files referenced by the primary page
- Any related sync code if the issue touches data ingestion

You cannot plan well from issue text alone. Read the code.

## 5. Write the plan file

For each group, write `plans/issue-<primary-number>.md` with this structure:

```markdown
# Plan: Issue #<n> — <title>

**Issues covered:** #<n1>, #<n2>, ...
**Primary file:** apps/web/src/app/<page>/page.tsx
**Worktree (build phase will create):** ../whoop-dashboard-issue-<n>
**Branch:** issue/<n>-<slug>
**Depends on:** #<n> (or "none")

## Summary
<2-3 sentences: what changes, why, where>

## Files touched
- `apps/web/src/app/<page>/page.tsx` — <what changes>
- `apps/web/src/lib/db.ts` — <which row type, which query function>
- `apps/web/src/app/api/<route>/route.ts` — <only if needed>
- `sync/daily_sync.py` — <only if needed>

## Architectural decisions
<For each non-obvious choice, state the decision + alternatives considered + why this one>

- **Decision 1:** <e.g. "Sleep stages stored as ms columns, not JSON blob — matches existing strain table pattern">
- **Decision 2:** ...

## Implementation steps
<Ordered, file-by-file. Specific enough that a Sonnet agent can execute without re-thinking>

1. **`db.ts`** — Add `SleepStagesRow` type with fields `deep_ms`, `rem_ms`, `light_ms`, `awake_ms`. Add `getSleepStages(date: string): SleepStagesRow | null` using `safeQuery`.
2. **`sleep/page.tsx`** — Import `getSleepStages`. Replace existing stage block (lines ~120-150) with proportional bar component. Use existing color tokens.
3. **API route** — Not needed; reads happen server-side in page.
4. ...

## Code structure (skeletons, not full impl)
<For new components, sketch the prop signature and key JSX shape. Not the full implementation — that's the worker's job.>

```tsx
// SleepStagesBar.tsx — new component
type Props = {
  deep_ms: number;
  rem_ms: number;
  light_ms: number;
  awake_ms: number;
};
// Renders a 100%-width horizontal bar split into 4 segments,
// each segment width = (segment_ms / total_ms) * 100%.
// Colors from theme.css tokens.
```

## Patterns to follow (from CLAUDE.md / existing code)
- DB reads: `safeQuery()` only
- DB schema: `openWrite()` + lazy ALTER (check `PRAGMA table_info` first)
- Charts: Recharts 3.8, match existing chart patterns
- No new npm deps unless explicitly required
- TypeScript row types in `db.ts`

## Acceptance criteria (from issue)
<Copy directly from the issue's acceptance section, line by line>

- [ ] <criterion 1>
- [ ] <criterion 2>

## Verification
- `npm run build` clean
- whoop-dev live check on `/<route>` — confirm rendered correctly with real data
- agent-browser screenshot

## Out of scope (explicit)
<List things a worker might be tempted to do that they should NOT do>

- No refactoring of unrelated chart components
- No new dependencies
- No styling changes outside the new component
```

## 6. Self-review pass

After writing all plan files, read them back end-to-end. Check:

- **Cross-file consistency:** if two plans both edit `db.ts`, do their sections collide? Call it out, define section ownership.
- **Pattern consistency:** all plans cite the same patterns (safeQuery, openWrite + lazy ALTER, Recharts).
- **Scope discipline:** every plan stays within the issue's surface. No "while we're here" additions.
- **Decisions stated:** anywhere you said "use X approach," is the *why* documented? A Sonnet worker can't re-derive it cheaply.

Fix any plan that fails self-review before reporting.

## 7. Report

Final message lists:
- Plan files written: `plans/issue-165.md`, `plans/issue-166.md`, ...
- Grouping decisions and the reasoning
- Any issues skipped (with reason)
- Any cross-cutting concerns the human should review before build phase kicks off (e.g. "issues #167 and #168 both touch `db.ts` — sections defined in plans, but worth confirming")

**Do not spawn build agents. Do not write code. Do not open PRs.** That's `PROMPT_BUILD_SWARM.md`'s job, after the human reviews `plans/`.

---

## Issues to Plan
