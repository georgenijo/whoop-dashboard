# agent-context

Docs that describe how we develop this repo with AI agents.

- [`pipeline.md`](pipeline.md) — the planner → reviewer → implementer → reviewer flow, plus `work` / `swarm` / `bug` / `chat` helpers.

## New machine setup

1. **Clone** — `git clone git@github.com:georgenijo/whoop-dashboard.git`
2. **Secrets** — `.env`, `tokens.json`, Apple `.p8`, VM SSH key. These are NOT in the repo. Transfer from a known machine via USB (see the handoff bundle pattern) or pull from the VM.
3. **Shell helpers** — `echo 'source ~/Documents/code/whoop-dashboard/scripts/zsh-helpers.sh' >> ~/.zshrc && exec zsh`
4. **CLI auth** — `gh auth login` and make sure `claude` (and `codex` if using `cwork`) are signed in.
5. **DB** — `mkdir -p shared && ssh whoop-vm 'sudo -u george cat /home/george/Documents/whoop-dashboard/shared/whoop_data.db' > shared/whoop_data.db`
6. **Run** — `cd apps/web && npm install && npm run dev`

After that, `work <issue#>` works from anywhere inside the repo.
