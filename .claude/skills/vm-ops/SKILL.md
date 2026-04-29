---
name: vm-ops
description: Operate the Whoop dashboard VM — SSH access, deploys, systemd service, logs, SQLite DB, cloudflared tunnel. Use whenever the user asks to deploy, restart the web app, pull logs, inspect prod DB, or otherwise touch the production VM.
---

# Whoop dashboard — VM ops

Production lives on an Oracle Cloud VM behind a Cloudflare tunnel. This skill captures the wiring so future sessions don't have to rediscover it.

## Hosts & users

| Item | Value |
|---|---|
| VM host | `129.80.134.194` |
| Public domain | `whoop.georgenijo.com` (Cloudflare tunnel → port 8501) |
| SSH user | `ubuntu` (sudo) |
| App user | `george` (NO sudo — see "Two-user dance") |
| SSH key | `~/.ssh/id_ed25519` |

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@129.80.134.194
```

## Two-user dance

`george` owns the repo + service but is **not in sudoers**. `ubuntu` has sudo but doesn't own the app files. Pattern:

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@129.80.134.194 \
  "sudo -u george bash -c 'cd ~/Documents/whoop-dashboard && <git/build commands>' \
   && sudo systemctl restart whoop-web"
```

- Repo work → `sudo -u george bash -c '...'`
- Systemctl / journalctl / reading root-owned files → straight `sudo` as ubuntu
- Trying to `ls /home/george/Documents/whoop-dashboard` as ubuntu = `Permission denied`. Always `sudo -u george ls …`.

## Filesystem

| Path | What |
|---|---|
| `/home/george/Documents/whoop-dashboard/` | Repo on VM |
| `/home/george/Documents/whoop-dashboard/apps/web/` | Next.js app (build + run from here) |
| `/home/george/Documents/whoop-dashboard/apps/web/.env.local` | `ANTHROPIC_API_KEY` lives here. Never expose via web UI |
| `/home/george/Documents/whoop-dashboard/shared/whoop_data.db` | SQLite, WAL mode, shared by sync + web |
| `/home/george/Documents/whoop-dashboard/tokens.json` | Whoop OAuth tokens (auto-refreshed) |
| `/home/george/Documents/whoop-dashboard/venv/` | Python venv for `sync/daily_sync.py` + backfill scripts |
| `/etc/systemd/system/whoop-web.service` | Service unit |

Local repo (mac): `/Users/georgenijo/Documents/code/whoop-dashboard/`. Same layout.

## Service: `whoop-web.service`

Runs `next start -p 8501` as `george`, restarts on crash, capped at 512M RAM. Cloudflare tunnel maps `whoop.georgenijo.com` → `localhost:8501`.

```bash
sudo systemctl status whoop-web --no-pager | head -10
sudo systemctl restart whoop-web
sudo journalctl -u whoop-web -n 100 --no-pager
sudo journalctl -u whoop-web -f                  # tail live
```

## Standard deploy flow

From local mac, after committing changes:

```bash
cd /Users/georgenijo/Documents/code/whoop-dashboard \
  && git push \
  && ssh -i ~/.ssh/id_ed25519 ubuntu@129.80.134.194 \
     "sudo -u george bash -c 'cd ~/Documents/whoop-dashboard && git pull && cd apps/web && npm run build' \
      && sudo systemctl restart whoop-web"
```

Build takes ~50s on the VM. After restart, hit `whoop.georgenijo.com` to verify. Hard-refresh the browser (Cmd+Shift+R) — Next chunks are aggressively cached.

## DB inspection

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@129.80.134.194 \
  "sudo -u george sqlite3 /home/george/Documents/whoop-dashboard/shared/whoop_data.db '.tables'"
```

Tables: `recovery`, `sleep`, `cycles`, `workouts`, `body`, `chat_messages`, `chat_logs`, `app_settings`. `chat_*` and `app_settings` are created on demand by Next.js (`CREATE TABLE IF NOT EXISTS` in `apps/web/src/lib/db.ts`).

## Coach / chat backend

`apps/web/src/app/api/chat/route.ts` runs in two modes, toggled in `/settings`:
- **API mode** — uses `ANTHROPIC_API_KEY` from `.env.local` via `@anthropic-ai/sdk`. Fast (~2-5s).
- **CLI mode** (default fallback) — spawns `/usr/local/bin/claude -p <prompt>` as a subprocess. Slow (~30-60s).

**Critical gotcha:** the claude CLI is logged in via OAuth, but `ANTHROPIC_API_KEY` in `.env.local` overrides that and breaks the CLI with `Error: exit 1`. The route strips it before spawning:
```ts
const cleanEnv = { ...process.env };
delete cleanEnv.ANTHROPIC_API_KEY;
cleanEnv.HOME = "/home/george";
spawn("/usr/local/bin/claude", [...], { env: cleanEnv });
```
Don't remove this — silently breaks CLI mode the next time the user toggles API mode off.

Every chat request logs to `chat_logs` table → visible at `/logs`.

## Backfilling Whoop data

Whoop API caps at ~180 days per range. Run from the VM:

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@129.80.134.194 \
  "sudo -u george bash -c 'cd ~/Documents/whoop-dashboard && source venv/bin/activate && python sync/daily_sync.py'"
```

For larger backfills, write a one-shot Python script that calls `WhoopClient.fetch_all_parallel()` with explicit `start`/`end` dates and upserts. There's no cron job set up yet — sync is manual or driven by the Streamlit app's "Sync" button.

## Gotchas

- **Next.js version is custom** — see `apps/web/AGENTS.md`. Don't rely on training-data Next.js patterns; check `node_modules/next/dist/docs/` for the installed version's APIs.
- **`useSearchParams` requires Suspense** in this Next build — wrap any client component using it (Sidebar, TopBar both wrapped in `app/layout.tsx`).
- **Browser cache bites hard.** After deploying CSS or chart changes, always Cmd+Shift+R. If reports of "old behavior" come in, suspect cache before code.
- **`.terraform/` directories blow up `git push`** (>100MB Terraform binary). Already in `.gitignore`, but if a fresh `terraform init` happens, double-check before staging.
- **Don't use `git add -A` blindly** — the repo has both `apps/web/src/app/logs/` (intentional) and `logs/` at root (gitignored runtime dir). The gitignore uses `/logs/` (anchored) to avoid masking the app route.

## Quick reference — common tasks

```bash
# Tail live logs
ssh -i ~/.ssh/id_ed25519 ubuntu@129.80.134.194 "sudo journalctl -u whoop-web -f"

# Check what's deployed
ssh -i ~/.ssh/id_ed25519 ubuntu@129.80.134.194 \
  "sudo -u george git -C ~/Documents/whoop-dashboard log --oneline -5"

# Inspect chat history table
ssh -i ~/.ssh/id_ed25519 ubuntu@129.80.134.194 \
  "sudo -u george sqlite3 /home/george/Documents/whoop-dashboard/shared/whoop_data.db \
   'SELECT id, role, substr(content,1,60), created_at FROM chat_messages ORDER BY id DESC LIMIT 10;'"

# Force-clear chat history without going through the UI
ssh -i ~/.ssh/id_ed25519 ubuntu@129.80.134.194 \
  "sudo -u george sqlite3 /home/george/Documents/whoop-dashboard/shared/whoop_data.db \
   'DELETE FROM chat_messages; DELETE FROM chat_logs;'"
```

When in doubt: SSH in, look around as `george`, and check `journalctl -u whoop-web` for the real failure mode.
