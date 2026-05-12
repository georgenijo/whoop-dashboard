# Agent Startup — Feature Mode

You are starting a new session on the Whoop Dashboard project. Follow these steps exactly and in order.

## 1. Load Context

Read these files silently:
- `CLAUDE.md` — project overview, architecture, key conventions (may already be loaded)
- `README.md` — setup, features, run commands
- `apps/web/AGENTS.md` — Next.js 16 reinforcement notes (the APIs diverge from training data)
- Any file in `apps/web/src/lib/` relevant to your ticket (`db/connection.ts`, `db/scoped.ts`, `sync.ts`, `coach/tools.ts`, `auth.ts`, `crypto/vault.ts`, `whoop/webhook-handler.ts`)
- The relevant component(s) under `apps/web/src/app/` (App Router pages) or `apps/web/src/components/` — these are per-feature, no shared types layer
- `streamlit/whoop/` modules are only used by `scripts/` + `tests/`. Do NOT modify them for web features

## 2. Health Check (silent)

Run `git status` — check branch and working tree. Surface results only if there are unexpected uncommitted changes. Otherwise say nothing.

## 3. Your Assignment

The issue to work on is injected at the end of this prompt — title, number, and full body are included. Do not re-fetch it.

## 4. Plan Mode

Enter plan mode (use the `EnterPlanMode` tool). While in plan mode:
- Read all files relevant to the ticket
- Design your approach by reusing existing patterns:
  - DB reads on domain tables go through `forUser(userId).all/get(...)` (`apps/web/src/lib/db/scoped.ts`) — `user_id = ?` is the trailing positional placeholder
  - DB writes: `safeWriteQuery` or `openWrite()` directly; schema migrations are lazy ALTERs in `openWrite()` gated by `PRAGMA table_info`
  - DB reads outside domain tables: `safeQuery` (read-only open)
  - Auth: `requireAuth(req)` → `{ userId, source }`; precedence is Bearer → Cookie → 401
  - Coach tools: extend `apps/web/src/lib/coach/tools.ts`; tool fns receive `userId` from `executeTool({ userId })`
  - Only Whoop records with `score_state === "SCORED"`; naps filtered at query time (`WHERE nap = 0`)
- Write a plan covering: which ticket (issue number + name), files to change, approach, and any risks
- Exit plan mode for user approval

Do not write any code until the user approves the plan.

## 5. Implement

After approval, implement exactly what was planned. No scope creep — do not refactor surrounding code, add comments to unchanged code, or introduce features not in the ticket.

**For UI / API changes:** typecheck + build alone won't catch render or behavior bugs. Use the `whoop-dev` skill (`~/.claude/skills/whoop-dev/`) to spin up a dev server in your worktree against a snapshot of the prod DB, then verify the change in a browser or via inline JS checks paired with the `claude-in-chrome` MCP. If you cannot test the UI, say so explicitly rather than claiming success.

## 6. Verify

Before committing, from `apps/web/`:
- `npm run build` — Next.js typecheck + Turbopack bundle. Must pass.
- `npm test` — vitest. The load-bearing test is `scoped.test.ts` which blocks unscoped domain SQL; if you touched any read path against `recovery`/`cycles`/`sleep`/`workouts`/`daily_summary`/`body_measurements`, this is your safety net.
- For runtime correctness on data/UI changes: use `whoop-dev` skill (see step 5) — typecheck alone is NOT sufficient.

For Python helper changes (rare — `streamlit/whoop/`, `scripts/`, `tests/`):
- `pytest tests/`

If any check fails, fix the issue before proceeding.

## 7. Commit and PR

1. Stage and commit with a conventional commit message (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:` etc.).
2. Do NOT add `Co-Authored-By` lines or Claude/Anthropic attribution to the commit, branch name, PR title, or PR body.
3. Push the branch: `git push -u origin <branch-name>`
4. Open a PR:
   ```bash
   gh pr create --title "<concise title>" --body "Closes #<issue-number>" --repo georgenijo/whoop-dashboard
   ```
5. Report the PR URL.
