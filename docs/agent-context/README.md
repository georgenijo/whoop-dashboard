# agent-context

Docs that describe how we develop this repo with AI agents.

- [`pipeline.md`](pipeline.md) — the planner → reviewer → implementer → reviewer flow, plus `work` / `swarm` / `bug` / `chat` helpers.

## New machine setup

1. **Clone** — `git clone git@github.com:georgenijo/whoop-dashboard.git`
2. **Secrets** — local `.env.local` and Apple `.p8` files are not in the repo. Provision them from the owner-approved secret source; never copy production runtime secrets into a worktree.
3. **Shell helpers** — `echo 'source ~/Documents/code/whoop-dashboard/scripts/zsh-helpers.sh' >> ~/.zshrc && exec zsh`
4. **CLI auth** — `gh auth login` and make sure `claude` (and `codex` if using `cwork`) are signed in.
5. **DB** — `mkdir -p shared && touch shared/whoop_data.db`; use the `whoop-dev` helper when a sanitized production snapshot is explicitly needed.
6. **Run** — `cd apps/web && npm ci && npm run dev`

After that, `work <issue#>` works from anywhere inside the repo.
