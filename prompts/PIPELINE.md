# Implementation Pipeline

Standard end-to-end flow for any code-changing issue in this repo. Referenced from `PROMPT.md`, `PROMPT_BUG.md`, and `PROMPT_SWARM.md`. Do not deviate without explicit human approval.

## 1. Plan

Enter plan mode. Read every file relevant to the ticket — actual code, not just headers. Write a plan covering:

- **Files to change** and why
- **Approach**, reusing existing patterns: `openWrite()` lazy ALTER, `forUser()` scoped reads, `safeQuery`, Recharts component shape, the coach provider abstraction, `requireAuth(req)`
- **Verification:** what build target, browser route, or curl confirms it works
- **Risks:** schema migration on existing data, auth changes, race conditions, idle gaps, rate limits, cross-process locks

Exit plan mode.

## 2. Architect review (soft cap 3)

Spawn the `whoop-architect` agent (subagent_type: `whoop-architect`) with the plan as input.

- **APPROVE** → step 3
- **ITERATE** → revise plan, re-submit
- Round 4+ requires written justification ("scope changed after research", "discovered hidden dependency"). Do not submit a plan you don't believe in.
- After round 3 with unresolved blockers, stop and surface to human (the user, or `swarm-lead` if you're inside a swarm).

## 3. Implement

Code the approved plan exactly. No scope creep, no surrounding-code refactor, no comments on unchanged lines, no "while I'm here" cleanup. If reality forces a deviation from the plan, return to step 2 with a short "plan delta" note.

**Commit cadence.** Don't accumulate the entire feature into one commit at the end. Commit after each logical step of the plan — a schema change, a new component, a wired-up endpoint, etc. Conventional commit prefixes per commit (`feat:`, `fix:`, `chore:`). Push freely; the branch is disposable until merge. Rationale: cheap recovery if the session crashes, easier reviewer diffs, easier to bisect later if a step breaks something.

If a step is mid-way and not yet runnable, that's fine — commit it as `wip:` or fold it into the next step. Don't game it by committing broken-on-purpose state and hiding behind a comment.

## 4. Reviewer loop (soft cap 3)

Spawn the `whoop-reviewer` agent on the diff.

- Address every BLOCK and WARN.
- NITs at your discretion.
- Re-run reviewer on the updated diff.
- Loop until reviewer reports no BLOCK and no WARN.
- Same soft-cap-3 rule as architect: round 4+ needs justification, beyond round 3 escalate.

Each fix round is its own commit (`fix(review): <what>`). Don't squash review iterations into the implementation commits — keep the audit trail.

## 5. Local verification

- `cd apps/web && npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
  All four are CI gates. `npm run lint` is `eslint --max-warnings 0`, so a warning fails the build. Do not assume `next build` covers lint or `tsc` — it does not.
- Python changes: `python3 -m py_compile streamlit/whoop/*.py` plus `pytest` for `tests/`.
  Note `streamlit/whoop/` is library code used only by `scripts/` and `tests/` — the Streamlit UI and the `sync/daily_sync.py` path were both retired.
- Rendering or behavioral changes: verify in a real browser via the `whoop-dev` skill, not just a green build.

If a check fails, fix and return to step 4.

## 6. Open PR

```bash
git push -u origin <branch>
gh pr create --title "<conventional title>" --body "Closes #<issue>" --repo georgenijo/whoop-dashboard
```

Conventional commit prefixes: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`. PR body must reference the issue.

## 7. Pre-merge browser-test gate

Spin up a dev server with a snapshot of production data:

```bash
RESULT=$(bash ~/.claude/skills/whoop-dev/bin/up.sh "$(pwd)")
URL=$(echo "$RESULT"  | jq -r .url)
PORT=$(echo "$RESULT" | jq -r .port)
```

The `whoop-dev` skill snapshots `shared/whoop_data.db`, copies the necessary secrets, and serves your worktree on a free port. Real data, isolated copy — safe to mutate.

Derive scenarios from the diff:

- **UI changes** — every route touched + critical flows that consume the changed component (overview ring, KPI strip, chart hover/tooltip, mobile bottom-nav)
- **API changes** — happy path + auth gate (`requireAuth`) + error path on every endpoint touched
- **DB / schema** — read-after-write + lazy ALTER on cold open (delete the temp DB column manually if needed and re-open to confirm idempotency)
- **Sync** — dry-run path + happy path + cooldown gate
- **Coach tools** — at least one chat turn that triggers the changed tool, verifying tool_use/tool_result blocks persist correctly

Run scenarios via:

- **`/agent-browser:agent-browser` skill (preferred).** Invoke via the `Skill` tool. The skill itself documents preference over any built-in browser automation. Use it for navigating, filling forms, clicking, screenshots, scraping, and any exploratory testing. Load with `Skill({ skill: "agent-browser:agent-browser" })`.
- **`claude-in-chrome` MCP** — fallback when the agent-browser skill can't reach (e.g., session already binds another Chrome window). Tools are deferred; load via `ToolSearch select:mcp__claude-in-chrome__*` only when actually used.
- **`curl $URL/api/...`** — API smoke and shape checks. Use for endpoint contract verification regardless of UI tooling.

If any scenario fails:

1. Fix on the same branch
2. Re-run reviewer (step 4) on the new diff
3. Re-run scenarios

Loop until every scenario passes. Do not bypass a failure with a "we'll handle it later" comment.

Tear down:

```bash
bash ~/.claude/skills/whoop-dev/bin/down.sh --port $PORT
```

## 8. Ready-to-merge

Post a PR comment summarizing scenarios:

- Routes browsed and what was checked
- Endpoints curled and what shape was verified
- Anything edge-case that you couldn't fully exercise (note explicitly)

Report PR URL to user (or to `swarm-lead` if inside a swarm). **Do not merge** — that's the user's call.

## Ground rules

- No `--no-verify`, no `--dangerously-skip-permissions`, no force-push.
- No Co-Authored-By in commits. No Claude/Anthropic attribution on commits, PRs, branches, or issue bodies.
- One issue, one branch, one PR. Don't bundle.
- If you hit an unexpected blocker (auth broken, dev server won't start, architect/reviewer disagree, scenarios reveal a deeper bug), stop and surface to human — don't bypass.
- Worktree work stays in worktree. Don't `cd` to other worktrees during the run.
