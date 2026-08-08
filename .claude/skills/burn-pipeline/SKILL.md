---
name: burn-pipeline
description: Drain the open-issue backlog by auto-discovering all open GitHub issues, triaging them into burnable lanes, and shipping each lane sequentially to prod (plan → build → review → local smoke → PR → merge → deploy → prod smoke) before starting the next. Stops on first prod-smoke failure. Each lane runs three explicit modes — planning, implementation, reviewer. Built for the Whoop Dashboard repo. Invoke with no arguments — the skill orchestrates "work until no more burnable issues". Trigger phrases — "burn-pipeline", "burn the backlog", "drain the issues", "burn until done".
---

# burn-pipeline — drain the open-issue backlog

A scripted playbook that pulls every open issue from the repo, decides which are burnable in this session, groups them into lanes, then ships them ONE AT A TIME all the way to prod. If any lane fails prod smoke, the pipeline stops — no further lanes start.

## Invocation

```
/burn-pipeline             # full run: discover → triage → ship each lane to prod
/burn-pipeline --dry-run   # discover + triage only; STOP at Gate 0, no code touched
```

**Zero positional arguments.** The skill auto-discovers the issue list. The active agent (you) is the orchestrator — you stay the orchestrator the whole time. No nested orchestrator agents.

### Dry-run mode

`/burn-pipeline --dry-run` is for sanity-checking the triage before trusting the skill with real edits. It runs:

- Stage 0 — fetch open issues.
- Stage 1 — Plan triage + lane analysis.
- Gate 0 — surface lane plan + deferred list to user.

Then **STOPS**. Does not:
- Create branches.
- Edit any file (no inline `Edit`, no builder spawn, no investigator spawn either — pure planning).
- Open PRs.
- Merge.
- Deploy.
- Run any local smoke (no whoop-dev, no agent-browser).

Output is purely "here's what I'd do". Use it once after writing/changing this skill, or any time the backlog shape has shifted and you want to see the lane breakdown before committing the session to a burn.

Re-invoke without `--dry-run` to actually execute the plan it produced. The triage may differ slightly on the second run (Plan is non-deterministic) — if you want to lock in a specific plan, copy it out of the dry-run report and pass it as the "lane plan" in the subsequent run.

## When to invoke

Trigger phrases: `/burn-pipeline`, "burn the backlog", "drain the issues", "burn until done".

**Use this skill when:** the user wants the open-issue list cleared in one session, sequentially, with prod ship + smoke per lane.

**Don't use this skill when:**
- Single bug or single feature (just work it directly; ceremony has no payoff).
- Architecture / design work (use `Plan` agent, no shipping).
- Issues need DB migration or schema change (manual deploy with snapshot — see CLAUDE.md "Deploy").
- iOS submission / TestFlight push (use `ios-builder` directly).

## Shape

```
Stage 0  Fetch open issues
Stage 1  Triage + lane analysis (one Plan call) — produces ordered lane list + deferred list
Stage 0.5 (Gate 0)  User confirms lane plan
Stage 2  Per-lane loop:
   2a Planning mode  (Plan, lane-scoped)
   2b Implementation mode  (investigator → builder | ios-builder | inline)
   2c Reviewer mode  (whoop-reviewer → fix BLOCKs)
   2d Local smoke  (whoop-dev + agent-browser)
   2e Gate 1 — open PR
   2f Gate 2 — merge
   2g Gate 3 — deploy
   2h Prod smoke
   → STOP pipeline on prod-smoke fail. Else next lane.
Stage 3  Final report
```

One lane = one branch = one PR = one merge = one deploy = one prod smoke. N lanes = N of each.

## Stage 0 — Fetch open issues

```bash
gh issue list --state open --limit 50 \
  --json number,title,body,labels \
  --repo $(gh repo view --json nameWithOwner --jq .nameWithOwner)
```

`--limit 50` ceiling. If repo has >50 open issues, the skill warns and processes the first 50 — user can re-invoke for the rest, or raise the limit.

Pre-flight checks before continuing:
1. `git status` on active worktree. Dirty → stop, surface to user.
2. `git checkout main && git pull origin main`.
3. Confirm `gh repo view` succeeds (auth working).

## Stage 1 — Triage + lane analysis

ONE call to the `Plan` agent. Pass it:
- The full list of open issues (numbers + titles + bodies + labels).
- Repo CLAUDE.md context.
- Relevant memory (`feedback_burn_down_pipeline`, `feedback_smoke_testing`).

Ask Plan to return:

**A. Burnable lanes** (will ship this session):
- Each lane: list of issue numbers + estimated file list + rough size (S/M/L).
- File-overlap basis for the grouping.
- Ordering with rationale (smallest-risk first by default; helpers-before-callers if dependencies exist).

**B. Deferred items** (will NOT ship this session) with one-line reason each:
- "needs design call" (architecture work)
- "needs DB migration" (manual flow required)
- "duplicate of #N" (suggest closing)
- "placeholder, needs investigation walk first" (do that walk separately, file sub-issues)
- "stale — likely fixed already" (verify, close)
- "scope >4 files, too large for burn" (its own future session)
- "blocked on external" (Apple review, Whoop API change, etc.)

**C. Risk callouts** per lane (CSS scoping that could regress, helper signature changes that ripple, server-only boundaries crossed).

**D. Session cap recommendation**: how many lanes is reasonable in one sitting given the batch? Plan picks based on lane sizes — typically 3–6 lanes per session before reviewer fatigue + PR sprawl set in.

## Stage 0.5 — Gate 0: user confirms lane plan

Pause. Surface to user, terse:
- "Found N open issues. Plan grouped them into K lanes + D deferred."
- One line per lane: `Lane <name> · issues #N1 #N2 · est M files · S/M/L`.
- One line per deferred: `Deferred #N: <reason>`.
- "Proceed? (y/n) — type 'edit' to tweak lane plan."

On `y`: continue to Stage 2.
On `n`: stop, report, exit.
On `edit`: ask user which lanes to drop/add/reorder, re-run Plan if needed.

This is the only place the user sees the full plan. After this gate, each lane runs through to prod before the next one starts.

## Stage 2 — Per-lane loop

For each lane in order:

### 2a. Lane planning mode

Second `Plan` call, **lane-scoped**: given these N issues + these M files, walk through the exact edit plan, per-issue smoke recipe, and risks.

Lane-Plan returns:
- Per-issue edit list (file:line target + sketch).
- Whether to spawn `caveman:cavecrew-investigator` first (cross-file caller audit, helper renames).
- Specialist choice per issue (see 2b).
- Per-issue smoke recipe (route to hit, DOM assertion, log grep).

Lane-Plan output ≤ ~200 words. If it bloats, narrow the lane — split it into two future-session lanes and skip the half that doesn't fit.

### 2b. Lane implementation mode

If Lane-Plan said so: spawn `caveman:cavecrew-investigator` to lock scope. One call, caveman-compressed file:line table.

Then pick implementation path PER ISSUE:

| Scope | Specialist |
|---|---|
| iOS — `apps/ios/**` (Swift, project.yml, entitlements) | `ios-builder` |
| Web surgical, 1–2 files | `caveman:cavecrew-builder` |
| Web cross-cutting, 3–4 files (helper + N callers) | inline `Edit` (builder refuses 3+) |
| Read-only locate before edit | `caveman:cavecrew-investigator` |
| New file < 50 lines | inline `Write` |

Branch name: `fix/<scope>-<short-topic>` (e.g. `fix/strain-tsb-legend-axis`). Branch from `main`.

One commit per issue. Conventional Commits. `Closes #N` in body. No Co-Authored-By, no AI attribution.

After each commit:
- `cd apps/web && npm run build` (web) OR `ios-builder` xcodebuild step (iOS).
- Run vitest hit by the changed files.
- Stop on red. Fix on NEW commit. Never amend.

### 2c. Lane reviewer mode

Spawn `whoop-reviewer` against the lane diff:
```bash
git diff main..HEAD
```
Pass it: commit list, closed issues, file list, risks from Lane-Plan.

Reviewer returns one line per finding, severity `BLOCK / WARN / NIT`.

- Every `BLOCK` → new commit fixing it → re-run reviewer ONCE. Still BLOCK → stop, surface to user.
- `WARN` ≤ 2 lines of code → fold in. Otherwise defer with comment in PR body.
- `NIT` → ignore unless it changes meaning.

If clean: log "review: clean" and move on.

### 2d. Lane local smoke — drive the UI with agent-browser

This stage is **UI-driven**. Curl + log grep are supplementary, not primary. Every fix gets exercised in a real headless Chromium via the `agent-browser` skill. Reference: `agent-browser skills get core --full` for the full command reference.

**Setup**

1. Start the local server:
   ```bash
   bash ~/.claude/skills/whoop-dev/bin/up.sh /Users/george-mac-mini/Documents/code/whoop-dashboard
   ```
   Capture `port` + `url` from the JSON output.

2. Mint a local-key JWT for `user_id=2` (the snapshot DB's primary user):
   ```ts
   // apps/web/scripts/mint-jwt-smoke.ts — DELETE after lane finishes
   import { SignJWT } from "jose";
   const key = new Uint8Array(Buffer.from(process.env.JWT_SIGNING_KEY!, "base64"));
   const now = Math.floor(Date.now() / 1000);
   new SignJWT({}).setProtectedHeader({alg:"HS256"}).setSubject("2")
     .setIssuer("coach-api").setIssuedAt(now).setExpirationTime(now+3600)
     .sign(key).then(t => console.log(t));
   ```
   Run via:
   ```bash
   JWT_SIGNING_KEY=$(grep '^JWT_SIGNING_KEY=' .env | cut -d= -f2-) \
     npx tsx apps/web/scripts/mint-jwt-smoke.ts
   ```

3. Authenticate the browser session:
   ```bash
   agent-browser cookies set __Host-coach_session "$JWT" \
     --url http://localhost:<port> --secure --httpOnly --path /
   ```

**Per-issue UI test (run this loop for every issue in the lane)**

Drive whatever flow the fix changes. The Lane-Plan dictates the specific routes + interactions. Minimum verifications:

1. **Navigate** to the affected route:
   ```bash
   agent-browser open http://localhost:<port>/<route>
   ```

2. **Snapshot the DOM** (text + interactive refs):
   ```bash
   agent-browser snapshot -i
   ```
   Returns a tree with `@eN` refs for interactive elements. Use these refs for subsequent `click` / `fill` / `type`.

3. **Verify expected text rendered.** Grep the snapshot output (or response HTML) for the strings the fix promises (subtitle text, delta label, error copy).

4. **Drive the user flow** the bug touches. Examples:
   - Bug changes a button behavior → `agent-browser click @eN` (or `agent-browser click "text=Submit"`)
   - Bug changes a form → `agent-browser fill @eN "input"`, then submit, then re-snapshot.
   - Bug changes navigation → click nav link, verify URL + new snapshot.
   - Bug changes default state → load page fresh, snapshot, compare default selected tab/range.

5. **Eval DOM measurements** when the bug is dimensional/computed-style (chart sizes, color values, layout dimensions):
   ```bash
   agent-browser eval "(() => {
     const el = document.querySelector('.chart-body .recharts-legend-wrapper svg');
     const r = el.getBoundingClientRect();
     return { width: r.width, height: r.height, attrW: el.getAttribute('width') };
   })()"
   ```

6. **Screenshot for visual record** (saved into the session log, useful for post-merge audit):
   ```bash
   agent-browser screenshot /tmp/lane-<name>-issue-<N>.png --full
   ```

7. **Check console errors** in the browser via the snapshot's surfaced errors, OR inspect the dev-server log (Next dev pipes browser errors back through SSE):
   ```bash
   tail -n 100 /tmp/whoop-dev-<port>.log | grep -iE 'error|exception|sanitize'
   ```

8. **Supplementary curl** for response-shape regression on API routes:
   ```bash
   curl -sS http://localhost:<port>/api/<route> -H "Cookie: __Host-coach_session=$JWT" | jq .
   ```

**Responsive check** (when fix touches layout/CSS):

```bash
agent-browser viewport 375 812          # iPhone-ish
agent-browser screenshot /tmp/lane-mobile.png --full
agent-browser viewport 1280 800          # back to desktop
```

Verify nothing breaks on narrow widths.

**Teardown**

```bash
agent-browser close                                   # kills browser session
bash ~/.claude/skills/whoop-dev/bin/down.sh --port <port>
rm -f apps/web/scripts/mint-jwt-smoke.ts /tmp/lane-*.png /tmp/local_jwt.txt
```

Delete the JWT mint script + any /tmp screenshots before pushing the branch. The mint script must never get committed.

**Stop conditions**

- Snapshot reveals missing element the fix was supposed to add.
- Eval returns wrong measurement (legend SVG is still 96px, RHR delta still says "vs yesterday" with 5d gap, etc).
- Expected text string absent from snapshot.
- Console error in dev log mentioning a known failure mode.
- Screenshot reveals visible regression in any other UI region (don't just look at the fixed bit — look around it).

Any stop condition → fix → re-build → re-snapshot. Never proceed to Gate 1 with a red smoke.

### 2e. Gate 1 — confirm PR open

Pause. Summarize:
- Lane name + branch.
- N commits, +X/-Y lines, M files.
- Per-issue smoke: ✓ each.
- Reviewer: clean / N BLOCKs fixed.

Prompt: `Lane <name> ready. Open PR? (y/n)`

On `y`:
```bash
git push -u origin <branch>
gh pr create --title "<conventional subject>" --body "..."
```
PR body: summary + commit list + diff stat + test plan + deferred follow-ups. No AI attribution.

### 2f. Gate 2 — confirm merge

```bash
gh pr view <num> --json mergeable,mergeStateStatus,statusCheckRollup
```
Wait for `MERGEABLE` + `CLEAN` + checks `SUCCESS`.

Prompt: `Lane <name> PR #<num> green. Merge + delete branch? (y/n)`

On `y`:
```bash
gh pr merge <num> --squash --delete-branch
git checkout main && git pull origin main
```

### 2g. Gate 3 — confirm deploy

Prompt: `Squashed as <sha>. Deploy to opti? (y/n)`

On `y`, use the canonical deploy script in the background:
```bash
scripts/deploy --ref <sha>
```
Don't poll. Wait for harness notification.

### 2h. Prod smoke

After deploy task completes (exit 0 + service active):

1. If an authenticated smoke is required, mint a short-lived JWT on `opti` without printing the signing key.
2. Use `fleet exec opti 'curl http://127.0.0.1:8501/<route> ...'`.
3. Verify `/api/health` reports the deployed SHA.
4. For visible fixes (strings, subtitles): grep response HTML.
5. For CSS fixes: curl the linked `/_next/static/chunks/*.css`, grep for the rule.
6. For iOS API: `curl http://localhost:8501/api/ios/<route>`, `jq` shape.
7. `fleet exec opti "journalctl --user -u whoop-web --since '2 min ago' --no-pager"` and inspect for new errors.

**Prod smoke fail → STOP entire pipeline.** Do not start the next lane. Surface to user:
- Failure detail (HTTP, missing string, journal error).
- Rollback recipe: `scripts/deploy --ref <previous-full-sha>`. DB restore remains a separate manual recovery.
- Wait for user direction.

Prod smoke pass:
- Mark lane task completed.
- One-line `lane <name> done: PR #<num>, deployed <sha>, prod ✓`.
- Next lane.

## Stage 3 — Final report

After the last lane ships clean:

1. Tally: K lanes merged + deployed, N issues closed, D deferred-from-triage carried over, W WARN deferred-to-followup.
2. Surface the deferred punch list (`Deferred from Gate 0` + `Deferred WARN per lane`) so the user has the next-session backlog.
3. Delete session-local artifacts: smoke scripts, /tmp JWTs, screenshots.
4. Suggest a follow-up burn date if the deferred list has 3+ now-burnable items. Don't auto-burn.

## Per-lane mode reference

Each lane has three discrete cognitive states. Be explicit about which one you're in.

### Planning mode

**Agents:** `Plan`.
**Output:** ≤200-word edit plan + risk list + smoke recipe.
**Forbidden:** code edits, branch creation, agent spawning beyond Plan.

### Implementation mode

**Agents:** `caveman:cavecrew-investigator` (locate), `caveman:cavecrew-builder` (1–2 file surgical), `ios-builder` (Swift / Xcode), inline `Edit` / `Write` (cross-cutting + new files).
**Output:** committed code on a lane branch. One commit per issue. Build green.
**Forbidden:** ad-hoc refactors, "while I'm here" cleanup, new abstractions for hypothetical reuse.

### Reviewer mode

**Agents:** `whoop-reviewer`.
**Output:** BLOCK/WARN/NIT punch list. New commits fixing BLOCK + selected WARN. Cleared diff.
**Forbidden:** speculative defensive coding, scope expansion, comment-only commits.

## Failure modes + recovery

| Symptom | Action |
|---|---|
| Triage Plan returns "all issues are deferred" | report to user with reasons; nothing to burn this session |
| Triage Plan flags a lane as too big | split into smaller lane or defer; never burn lanes > 4 files |
| Investigator says "no callers" for a helper | confirm with user — issue may be stale (close it?) |
| `npm run build` fails | fix on new commit, re-build, never amend |
| Reviewer BLOCK persists after 1 fix attempt | stop, surface to user. No band-aids (`feedback_no_speculative_defenses`) |
| Local smoke fails | revert breaking commit (`git revert <sha>`, NOT `reset --hard`), re-investigate |
| `agent-browser` snapshot missing expected element | the fix did not render — check React component path, check SSR vs client boundary (most common cause: client component crashed silently and SSR fallback rendered empty) |
| `agent-browser eval` returns wrong measurement | the CSS rule didn't land — check specificity, check whether the bundle was regenerated (Next dev hot-reload is mostly reliable but exceptions happen — restart `whoop-dev`) |
| Screenshot reveals regression outside the fix area | another lane interacted with this one; serialize the lanes more aggressively or split the lane |
| CI red after push | new commit fixing, push, wait again. NEVER force-push |
| opti deploy build fails | inspect deploy output and `journalctl --user`; see the legacy-named `vm-ops` skill |
| **Prod smoke fails** | **STOP pipeline.** Surface rollback recipe. No auto-rollback. No next lane. |

## What this skill does NOT do

- iOS app submissions / TestFlight pushes (separate flow).
- Database migrations / schema changes (manual deploy with DB snapshot per CLAUDE.md).
- Multi-lane integration PRs (this skill ships per-lane).
- Auto-rollback (humans approve rollbacks).
- Skip gates (the 3 confirms are load-bearing).
- Spawn nested orchestrator agents (orchestrator is always the main thread).

## Conventions enforced

- Conventional Commits (`fix(scope):`, `chore(scope):`).
- No Co-Authored-By, no AI attribution.
- One commit per issue (one extra for reviewer fixes if needed).
- `Closes #N` in commit body — auto-closes on squash merge.
- Branch: `fix/<scope>-<short-topic>` or `chore/<scope>-<short-topic>`.
- All scripts cleaned up before finishing the lane.

## Memory references

- `feedback_burn_down_pipeline` — validated lane-mode pattern.
- `feedback_smoke_testing` — local smoke mandatory for DB/API/decoder change.
- `feedback_plan_review` — verify Plan's external API claims, name infra prereqs done/todo.
- `feedback_no_speculative_defenses` — no band-aids for theoretical bugs.
- `feedback_explanation_register` — when scope gets heavy, switch to plain-English summary for the user.

## Related skills + agents used

| Stage | Specialist | Purpose |
|---|---|---|
| 0 | `gh` CLI | Fetch open issue list |
| 1, 2a | `Plan` | Triage + lane grouping + per-lane edit plan |
| 2b | `caveman:cavecrew-investigator` | Read-only file:line locate |
| 2b | `caveman:cavecrew-builder` | Surgical 1–2 file edit |
| 2b | `ios-builder` | Swift + Xcode + project.yml + entitlements |
| 2c | `whoop-reviewer` | Repo-aware pre-merge diff audit |
| 2d | `whoop-dev` | Local dev server with prod DB snapshot |
| 2d | `agent-browser` | **Primary UI test driver** — navigate, click, fill, snapshot, eval, screenshot. Every fix gets exercised in a headless Chromium, not just curled. |
| 2g | `vm-ops` | Fleet + user systemd + SQLite + Cloudflare Tunnel |
| 2c, 3 | `decisions` | Log any architectural choice made during the burn |

## Example session

```
User: /burn-pipeline
```

Skill runs Stage 0: `gh issue list` returns 13 open issues.

Skill runs Stage 1: Plan triages and reports back —
- **Burnable (3 lanes):**
  - Lane A: #378 + #381 · strain chart fixes · 2 files · S
  - Lane B: #379 · TrendChart Y-axis · 1 file affecting 3 pages · M
  - Lane C: #316 · coach disconnect recovery · 2 files · M
- **Deferred (10):**
  - #331 Google SIWA — needs product call
  - #377 CDN icons — 6 files + new dep, separate session
  - #263 + #273 + #274 + #287 — Whoop refresh cluster, design problem
  - #305, #328, #233 — foundation infra
  - #304 — wait for next flake to reveal cause
- **Session cap:** 3 lanes (~90 min total).

User approves at Gate 0. Skill burns Lane A → ship + prod-smoke → Lane B → ship + prod-smoke → Lane C → ship + prod-smoke. Stage 3 reports 10 deferred for next session.

If Lane B's prod smoke fails after deploy: skill stops, surfaces rollback recipe, Lane C never starts.
