# Agent brief — whoop-dashboard

This file is the global brief for any AI coding agent (Codex, Claude Code, Cursor, Aider) working on this repo. Read it before starting any task. Individual GitHub issues describe specific tasks; this file describes the rules and architecture all tasks share.

## What this is

A personal data hub. Pulls Whoop wearable data today, will pull calendar / nutrition / Apple Health and unify under one analytics + AI-coach layer. Single user, self-hosted on an Oracle Cloud VM at `whoop.georgenijo.com` behind a Cloudflare tunnel. SQLite is the canonical store. Server-side OAuth vault for all third-party tokens.

## Architecture target

```text
whoop-dashboard/
├── apps/
│   ├── web/                Next.js 16 App Router — UI + API server
│   └── ios/                SwiftUI — coming
├── sync/                   Python cron — polls third-party APIs, writes to SQLite
├── shared/
│   └── whoop_data.db       Canonical SQLite DB (lives here, not at repo root)
├── infra/                  Terraform + deploy scripts
├── systemd/                Production unit files for the VM
├── streamlit/              LEGACY — do not modify
├── tokens.json             Whoop OAuth tokens (will move into integrations table)
└── .github/                Issue templates, workflows
```

Both web and iOS clients call the same `/api/*` routes on Next.js. Bearer-token auth via Sign in with Apple. Sync polls on cron and can also be manually triggered via `POST /api/sync`.

## Build / test commands

| What | Command | Notes |
|---|---|---|
| Web build | `cd apps/web && npm run build` | Must succeed before commit |
| Web dev | `cd apps/web && npm run dev` | Hot reload on :3000 |
| Sync | `python sync/daily_sync.py` | Pulls Whoop data into shared/whoop_data.db |
| DB inspect | `sqlite3 shared/whoop_data.db ".schema"` | Read-only check |
| Lint | (none configured) | — |

## Hard rules — never violate

1. **Branch off main, open a PR.** Do not push directly to main.
2. **No AI attribution.** Never add "Co-Authored-By: Claude" / "Co-Authored-By: GPT" / "Generated with Claude Code" / "🤖 Generated with…" / similar to commit messages, PR descriptions, branch names, issue bodies, or comments. The user enforces this strictly.
3. **Do not move `shared/whoop_data.db`** from its current location. It is the production DB and the path is hardcoded in deployed services.
4. **Do not move `tokens.json`** from repo root until an issue explicitly migrates it.
5. **Do not touch `streamlit/`.** Legacy app, deprecated.
6. **Match existing style.** TypeScript strict, Next.js App Router conventions. Two-space indent. No emoji unless asked.
7. **No new top-level dependencies** unless the issue explicitly approves. Adding a package is a design decision.
8. **No secrets in code.** Read from env vars. The repo `.env` is gitignored.
9. **No destructive git ops** (`reset --hard`, `push --force`, `branch -D`) without explicit user request.

## Important environment notes

- The web app reads `shared/whoop_data.db` via `process.cwd() + relative path`; from `apps/web`, the relative path is `../../shared/whoop_data.db`. The override env var `WHOOP_DB_PATH` is honored if set (production sets it).
- This is **Next.js 16** (custom version). APIs differ from public Next.js. Read `apps/web/AGENTS.md` and `apps/web/node_modules/next/dist/docs/` before relying on training-data Next.js knowledge.
- AI calls use `claude-sonnet-4-6` with `thinking: { type: "adaptive" }`. Keep Coach model changes explicit and consistent across the tool-use loop.
- The Anthropic SDK is preferred over the Claude CLI for production code paths. CLI fallback exists in `apps/web/src/app/api/chat/route.ts` — consider it deprecated.

## Conventions

- DB access goes through `apps/web/src/lib/db.ts`. Add new query helpers there, not inline in routes.
- API routes return JSON via `Response.json()`.
- Server Components for read-only pages, Client Components only when interactivity is needed.
- Time series queries should use the `daily_summary` table (once it exists) instead of joining raw tables in the request path.
- All third-party OAuth tokens live in the `integrations` table (once it exists), not in JSON files.

## Verification before opening a PR

1. Build succeeds for the current repo state: `cd apps/web && npm run build`
2. The acceptance criteria from the issue are all checked off, with command output pasted in the PR description.
3. `git status` is clean on the task branch.
4. PR title matches the format from the issue.
5. No AI attribution anywhere.

## Reference

- VM ops: `.claude/skills/vm-ops/SKILL.md`
- Web-specific notes: `apps/web/AGENTS.md`
- Project README: `README.md`
- Workspace overview (multi-project): `../CLAUDE.md` (parent dir, not this repo)

## Glossary

- **Whoop** — wearable fitness band; OAuth API at `api.prod.whoop.com/developer`.
- **Coach** — in-app AI chat using Claude.
- **VM** — the Oracle Cloud server hosting `whoop.georgenijo.com`.
- **Sync** — daily polling job that pulls Whoop data into SQLite.
- **Integrations vault** — server-side table holding OAuth tokens for every third party.
- **Hub** — the long-term framing of this project (Whoop is one source of many).
