# Agent Development Pipeline

How we develop on this repo with AI agents. Everything below is wired through `scripts/zsh-helpers.sh` and `prompts/*.md`.

## TL;DR

```bash
work 312       # single issue — planner → review → impl → PR
swarm 309 310  # lead agent spawns N parallel sub-agents
bug            # bug-hunt session
chat           # free-form discussion session
```

Every helper reads its template from `prompts/` in the repo root. Templates control behavior — edit those, not the shell functions.

## Single-issue flow: `work <issue#>`

```
work 312
  │
  ▼ planner (Claude in plan mode)
    reads CLAUDE.md, README, files relevant to ticket
    writes plan → exits plan mode
  │
  ▼ you review the plan, approve or send back for changes
  │
  ▼ implementer (same agent, post-approval)
    writes code, follows existing patterns
  │
  ▼ verifier (in-agent)
    npm run build (apps/web)
    py_compile streamlit/*
    whoop-dev skill for runtime/UI checks
  │
  ▼ git commit + push + gh pr create
  │
  ▼ optional: /ultrareview <PR#>     (multi-agent cloud review, billed)
  │           whoop-reviewer agent   (in-repo read-only reviewer)
  │
  ▼ you merge
```

Template: [`prompts/PROMPT.md`](../../prompts/PROMPT.md).

## Multi-issue flow: `swarm <issue#>...`

```
swarm 309 310 311
  │
  ▼ lead agent
    git pull main
    TeamCreate "swarm"
    for each issue:
      git worktree add ../whoop-dashboard-issue-N -b issue/N-slug
      Agent({ subagent_type: "general-purpose", team_name: "swarm",
              mode: "plan", prompt: sub-agent template + issue body })
  │
  ▼ N sub-agents in parallel
    each enters plan mode → writes plan → submits to lead
  │
  ▼ lead reviews each plan critically
    approve if focused + idiomatic
    reject with specific feedback ("belongs in db.py", "reuse _build_context()")
  │
  ▼ sub-agents implement after approval → push → gh pr create
  │
  ▼ lead reports PR URLs → TeamDelete
```

Template: [`prompts/PROMPT_SWARM.md`](../../prompts/PROMPT_SWARM.md).

## Roles

| Role | Where | Triggered by |
|---|---|---|
| Planner | `Plan` agent type / `EnterPlanMode` | implicit in `work`; explicit via `Agent({subagent_type: "Plan"})` |
| Plan reviewer | You (single-issue) or lead agent (swarm) | manual approve/reject in plan mode |
| Implementer | Same agent post-approval, OR sub-agents in swarm | plan approved |
| Code reviewer | `whoop-reviewer` agent + `/ultrareview` | post-PR; `whoop-reviewer` is read-only, usable any time |
| Institutional memory | `~/.claude/projects/<slug>/memory/` + `docs/decisions/DECISIONS.md` | auto-loaded; `/decisions add` skill to append |

## Verification gates

- `cd apps/web && npm run build` — typecheck + bundle
- `cd apps/web && npm test` — vitest; the load-bearing one is `scoped.test.ts` (blocks unscoped domain SQL)
- `whoop-dev` skill — spin up dev server in a worktree against a prod-DB snapshot for UI/behavior checks
- ESLint via `eslint-config-next`
- Python: `pytest tests/` for helper modules
- GitHub Actions repeats install, test, build, and deploy-script syntax checks

## Deploy

Merge through a pull request, wait for CI, then deploy explicitly through Fleet:

```bash
scripts/deploy --check
scripts/deploy --ref <CI-validated-full-sha>
```

The script builds on `opti`, creates an online SQLite backup, atomically switches
the immutable release, restarts the user services, and verifies local and public
health. Full provisioning, migration, rollback, and tunnel procedures are in
[`docs/operations/environment-and-deploy.md`](../operations/environment-and-deploy.md).

## Prerequisites on a dev machine

1. `gh` authed: `gh auth login`
2. `claude` CLI installed and authed
3. `codex` CLI (only if you use `cwork`)
4. `jq`
5. `source <repo>/scripts/zsh-helpers.sh` from `~/.zshrc`

Once those are in place, `work 123` works from any dir inside the repo.
