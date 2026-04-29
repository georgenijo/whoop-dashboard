# Agent Startup — Rebuild Mode (Claude Code Web)

You are a **Claude Code Web** session working on the Whoop Dashboard rebuild in a sandboxed environment. You **cannot** reach the user's local machine (Mac) or deploy target (OptiPlex). All work happens inside this cloned repo.

## 1. Load context (silent)

Read these in order:
1. `docs/rebuild/GUIDE.md` — status + machine matrix + phase-by-phase. **Your map.**
2. `docs/rebuild/PLAN.md` — architectural rationale (locked, don't relitigate).
3. `CLAUDE.md` — current Streamlit system (reference for porting).
4. `docs/rebuild/SPIKE_A_REPORT.md` — chart tuning decisions (if you're doing chart work).

## 2. What you can do

- **Code:** Edit any file in the repo. Write TypeScript, Python, CSS, markdown.
- **Install + build:** `pnpm install`, `pnpm build`, `pnpm tsc --noEmit` inside `apps/web/`.
- **Test structure:** Run Next.js dev server and verify components render with fixture data.
- **Type check and lint:** Catch compile errors and obvious bugs before pushing.
- **Open PRs:** `gh pr create` against `main`.

## 3. What you cannot do — skip these and flag them

You are **not** on the OptiPlex. Anything requiring Podman, systemd, tailscale, live Whoop OAuth, or the production SQLite DB is out of scope. Specifically:

| Blocked task | Why | What to do instead |
|---|---|---|
| Spike B (Claude CLI in Podman) | No Podman access | Leave alone — issue #53 has a runbook for the user |
| Build/test the Containerfile | No Podman | Author the Containerfile and a dry-run `pnpm build` locally; the user runs `podman build` on OptiPlex |
| Install Quadlet units | No systemd root | Author the `.pod` / `.container` files under `ops/quadlet/` and an `install.sh`; user runs it |
| Real Whoop OAuth | No client creds, no redirect URI reachable | Use fixture `tokens.json` for types; validate the route shape, not a live flow |
| Read/write the real `whoop_data.db` | DB lives on OptiPlex | Seed a fixture DB under `shared/fixtures/whoop_data_sample.db` with synthetic data; wire reads to point at it in dev mode |
| Restart Streamlit systemd | No OptiPlex | Don't even try |

**Rule:** if an issue's verification section requires an OptiPlex-only action, do the code portion, note the blocked verification step in the PR description, and ask the user to run the OptiPlex half.

## 4. Find your task

1. Check `GUIDE.md` **Status snapshot** — current phase
2. `gh issue list --label rebuild --state open` — open backlog
3. Filter: pick an issue whose work is **code-only** (per the machine matrix in `GUIDE.md`). As of Phase 1, safe picks are **#54 (reorg)**, **#55 (SQLite migration, code + fixture DB)**, **#56 (Next.js scaffold)**. **#57 (Containerfile) requires user collaboration** — only do the authoring half.
4. Confirm the choice by commenting on the issue before starting: "Claiming this from Claude Code Web; scope limited to code authoring."

## 5. Workflow

- **Enter plan mode first.** Design the approach citing `GUIDE.md` and the issue body. Exit for approval.
- Implement against the issue's spec
- Type-check: `cd apps/web && pnpm tsc --noEmit`
- Build: `cd apps/web && pnpm build` (once scaffold exists in #56)
- Commit on a feature branch `rebuild/<issue-number>-<slug>`, push, `gh pr create --base main`
- PR description **must** include:
  - `Closes #<issue>`
  - What was done (code scope)
  - What was **not** done (OptiPlex verification, live testing, etc.) — explicit for user followup
  - Any deviations from GUIDE.md (surface, don't hide)

## 6. Ground rules

- **Don't relitigate locked decisions.** See `PLAN.md` §"Locked Decisions".
- **Don't touch Oura issues** (#41–#49).
- **Don't fabricate OptiPlex state.** If you need to know something about the box (Podman version, file contents, service status), ask the user instead of guessing.
- **No `--dangerously-skip-permissions`, `--no-verify`.**
- **Leave `streamlit/app.py`, `streamlit/whoop/*.py`, and `sync/daily_sync.py` running** — the reorg moves them without changing behavior. The live Streamlit on OptiPlex still needs to work until the user updates the systemd unit (which is user-manual work).
- **Fixture data is OK; mock `claude` CLI is OK.** Don't invent real Whoop API responses.

## 7. When you're done

- Post PR URL
- Comment on the issue: what's merged, what's left for the user (e.g. "OptiPlex-side: run `./ops/quadlet/install.sh`")
- If you updated `GUIDE.md` status snapshot in your PR, call it out

## Anti-patterns specific to web sandbox

- Don't try to `ssh` to OptiPlex — it's not reachable.
- Don't try to run `podman` — it's not installed.
- Don't try to read `~/Downloads/Whoop_ Design System/` — that's on the user's Mac. If you need a DS asset not already in the repo, ask the user to paste it.
- Don't exceed scope of a single issue to "fix something nearby" — open a new issue instead.
