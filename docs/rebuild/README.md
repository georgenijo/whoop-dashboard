# Rebuild — Next.js + Whoop+ Design System

This folder is the durable, portable record of the Whoop Dashboard rebuild. Anyone (or any agent) cloning this repo should be able to pick up where work left off by reading this folder in order.

## Files in this folder

| File | What it is |
|---|---|
| [`PLAN.md`](./PLAN.md) | Architectural plan — the "why" and "what". Locked decisions, phasing, critical files, risks. Read this first. |
| [`GUIDE.md`](./GUIDE.md) | Implementation guide — the "how". Status snapshot, machine matrix, phase-by-phase playbook. **The living doc an agent executes from.** |
| [`SPIKE_A_REPORT.md`](./SPIKE_A_REPORT.md) | Spike A findings (Recharts fit). Done 2026-04-22. Locks in tuning decisions for Phase 1. |

## Related artifacts

- **Kickoff prompts** live in [`../../prompts/`](../../prompts/):
  - `PROMPT_REBUILD.md` — local/OptiPlex session (requires tailscale ssh)
  - `PROMPT_REBUILD_WEB.md` — Claude Code Web session (sandbox-safe)
- **GitHub issues** labelled `rebuild` track the work: `gh issue list --label rebuild --state open`
- **Design system** lives outside the repo at `~/Downloads/Whoop_ Design System/` on the maintainer's Mac (not version-controlled here by choice — it's a generated asset). For cloud agents without access: `colors_and_type.css` and the JSX reference kit were copied into the scratch spike repo; relevant extracts land in `apps/web/` during Phase 1.

## How to use this folder

**If you're a human:**
1. Read `PLAN.md` to understand the rebuild
2. Read `GUIDE.md` to see current status and pick a phase
3. Pick an open `rebuild`-labeled issue, use your normal `work <#>` flow

**If you're an agent starting a session:**
- Local/OptiPlex: load `prompts/PROMPT_REBUILD.md` as your first message
- Claude Code Web: load `prompts/PROMPT_REBUILD_WEB.md` as your first message
- Both will direct you here.

## Keeping this folder current

Update `GUIDE.md` at each phase transition:
- Move the status snapshot forward
- Mark phase-N issues closed
- Add retrospective notes if any decisions changed

Don't update `PLAN.md` after decisions lock — it's the historical record. Create an ADR under `docs/rebuild/adr/` if a locked decision needs to change.
