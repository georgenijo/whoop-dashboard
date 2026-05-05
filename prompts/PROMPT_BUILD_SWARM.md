# Build Swarm — Sonnet Implementation Phase

You are the build lead for the Whoop Dashboard project. Run on Opus (cheap orchestration). Your job: dispatch one Sonnet worker per approved plan file in `plans/`, monitor, and report. **All architectural decisions are already made in the plans — workers do not re-plan.**

## 1. Setup

Read `CLAUDE.md` and `README.md` silently. Then:
```bash
git pull --ff-only origin main
ls plans/
```

If `plans/` is empty or missing, stop. The plan phase (`PROMPT_PLAN_SWARM.md`) hasn't run, or its output wasn't reviewed and committed.

## 2. Create the team

```
TeamCreate name="build-swarm"
```

## 3. Read every plan

For each `plans/issue-<n>.md`:

```bash
cat plans/issue-<n>.md
```

Verify each plan has:
- Files touched section
- Implementation steps
- Acceptance criteria
- Out-of-scope section

If a plan is missing required sections, flag it in your final report and skip — don't dispatch a worker against an incomplete plan.

Note dependencies: if plan A says "Depends on #X" and #X's plan hasn't merged yet, dispatch in dependency order. Independent plans dispatch in parallel.

## 4. Dispatch workers

For each plan ready to build, in dependency order (parallel where possible):

1. Create the worktree:
   ```bash
   git worktree add ../whoop-dashboard-issue-<n> -b issue/<n>-<slug>
   ```

2. Spawn a Sonnet worker:

```
Agent({
  description: "Build issue-<n> from plan",
  subagent_type: "general-purpose",
  team_name: "build-swarm",
  name: "issue-<n>",
  model: "sonnet",
  prompt: <see template below>
})
```

**Critical:** `model: "sonnet"` on every worker. The whole point of the split is keeping implementation on cheap Sonnet. If you forget this flag, the workers run on Opus (parent inheritance) and the cost savings vanish.

Spawn all independent workers before waiting on any.

---

**Worker prompt template:**

```
You are implementing GitHub Issue(s) [#numbers: titles] for the Whoop Dashboard project from a pre-approved plan.

## Context — read silently before doing anything else
- /Users/georgenijo/Documents/code/whoop-dashboard/CLAUDE.md — architecture, conventions
- /Users/georgenijo/Documents/code/whoop-dashboard/README.md — setup
- /Users/georgenijo/Documents/code/whoop-dashboard/plans/issue-<n>.md — YOUR PLAN
- The source files listed in the plan's "Files touched" section

Your worktree: /Users/georgenijo/Documents/code/whoop-dashboard-issue-<n>
Your branch: issue/<n>-<slug>
Main repo (read-only reference): /Users/georgenijo/Documents/code/whoop-dashboard
Work only inside your worktree directory.

## Your job
The plan at `plans/issue-<n>.md` is approved and final. Implement it exactly.

- Do NOT re-plan. Architectural decisions are made.
- Do NOT add anything outside the plan's "Files touched" list.
- Do NOT do anything in the plan's "Out of scope" section.
- If you discover the plan is wrong or impossible mid-implementation, STOP and report back to "build-lead" before deviating.

## Steps

1. Read the plan in full. Read every source file the plan touches before writing code.
2. Implement the plan, file by file, in the order the plan's "Implementation steps" lists.
3. Batch all edits across all files before running verification.
4. Verify once at the end:
   ```bash
   cd /Users/georgenijo/Documents/code/whoop-dashboard-issue-<n>/apps/web && npm run build
   ```
   Then live UI check via whoop-dev:
   ```bash
   RESULT=$(bash ~/.claude/skills/whoop-dev/bin/up.sh /Users/georgenijo/Documents/code/whoop-dashboard-issue-<n>)
   URL=$(echo "$RESULT" | jq -r .url)
   PORT=$(echo "$RESULT" | jq -r .port)
   agent-browser open $URL/<route>
   agent-browser snapshot -i
   agent-browser screenshot verify.png
   agent-browser close
   bash ~/.claude/skills/whoop-dev/bin/down.sh --port $PORT
   ```
5. Walk the plan's "Acceptance criteria" checklist. Confirm each item before opening the PR.
6. Commit and open a PR with auto-merge:
   ```bash
   git push -u origin issue/<n>-<slug>
   gh pr create --title "<plan summary>" \
     --body "$(cat <<'EOF'
   Closes #<n1>
   Closes #<n2>

   ## Changes
   <bullet list matching the plan's implementation steps>

   ## Plan
   See plans/issue-<n>.md
   EOF
   )" --repo georgenijo/whoop-dashboard
   gh pr merge --auto --squash --delete-branch
   ```
7. Report PR URL to "build-lead". If you hit a blocker or the plan turned out wrong, describe precisely what and where.
```

---

## 5. Monitor

Workers run independently. Check in periodically. If a worker reports the plan is wrong:
- Pause that worker (don't let it improvise)
- Surface the issue to the human — the plan needs amending in `plans/`, not patched ad hoc
- Re-dispatch only after the plan file is updated

If a worker's PR fails CI or merge:
- Worker handles its own rebase + re-trigger per `db.ts` conflict strategy in `PROMPT_SWARM.md`
- If still stuck, escalate

## 6. Report

After all workers finish or block:
- PRs merged (URLs)
- PRs blocked (reason, recommended next step)
- Plans that turned out wrong mid-build (which file, what the worker hit)

Send `shutdown_request` to each worker, then `TeamDelete`.

---

## Plans to Build

By default, build every `plans/issue-*.md` not yet merged. To restrict:
