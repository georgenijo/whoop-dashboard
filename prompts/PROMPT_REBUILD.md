# Agent Startup — Rebuild Mode (Local / OptiPlex)

You are starting a new session on the Whoop Dashboard rebuild. This prompt is evergreen — it doesn't hard-code a phase. Figure out the current phase from `docs/rebuild/GUIDE.md` and continue from there.

## 1. Load context (silent)

Read these in order:
1. `docs/rebuild/GUIDE.md` — status snapshot + machine matrix + phase-by-phase playbook. **This is your map.**
2. `docs/rebuild/PLAN.md` — architectural plan (why we're rebuilding, locked decisions). Skim unless you need to revisit a decision.
3. `CLAUDE.md` — current Streamlit architecture (reference for porting).
4. `docs/rebuild/SPIKE_A_REPORT.md` — tuning decisions for Recharts (only if you're doing chart work).

## 2. Health check (silent)

Run in parallel, surface only if something's off:
- `git status` — clean working tree or expected changes
- `gh auth status` — logged in
- `/Applications/Tailscale.app/Contents/MacOS/Tailscale ssh george@optiplex 'echo ok'` — confirms OptiPlex reachable (only needed if your task touches the OptiPlex)

## 3. Find your task

1. Check **Status snapshot** in `GUIDE.md` — current phase and open blockers
2. `gh issue list --label rebuild --state open --repo georgenijo/whoop-dashboard`
3. Pick an issue that's in the active phase and whose dependencies are done
4. Confirm the choice with the user if ambiguous

## 4. Workflow (per issue)

Follow the standard `PROMPT.md` workflow:
- Enter plan mode, design the approach, cite files from `GUIDE.md` and actual code
- Exit plan mode for user approval
- Implement
- Verify (type check, build, local run where applicable)
- Commit, push, open PR with `Closes #<issue>` in body
- Report PR URL

## 5. Ground rules

- **Mac = dev, OptiPlex = deploy.** Anything that needs to run on the OptiPlex uses tailscale ssh via the full path: `/Applications/Tailscale.app/Contents/MacOS/Tailscale ssh george@optiplex '<cmd>'`. **The Bash tool does not inherit zsh aliases**, so the `tailscale` alias you see in an interactive shell won't work here.
- **State-changing OptiPlex commands** (systemctl, podman run, file writes under `/home/george/Documents/whoop-dashboard`, pod destroys) require explicit user approval. Read-only recon is fine.
- **Preserve the live Streamlit app** on OptiPlex until Phase 4. Don't restart its systemd unit, don't move files it reads without updating the unit.
- **Don't touch Oura-tagged issues** (#41–#49). Python-side Oura work runs in parallel; don't rewrite it.
- **No escapes:** no `--dangerously-skip-permissions`, no `--no-verify`, no `git reset --hard` on work you didn't just create.
- **One issue per branch**, PR to main. `main` stays deployable (streamlit + Next.js both build).

## 6. When you're done

Post a final summary:
- Link to PR(s)
- Issue(s) closed
- Any blockers or surprises discovered
- If `GUIDE.md` needs updating (status snapshot, new notes), either update it in the same PR or flag it to the user

## Anti-patterns

- Don't relitigate the 6 locked decisions in `PLAN.md`. If you want to change one, open an ADR first.
- Don't run the spikes again — Phase 0 is done. Spike B is still open; run it only if explicitly asked.
- Don't pull the scratch spike code from `~/Documents/code/scratch-whoop-spike-a/` as a dependency. Copy learnings, not imports.
- Don't scope-creep a phase-1 issue into fixing phase-2 things. One issue, one PR.
