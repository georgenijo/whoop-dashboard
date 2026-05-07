---
name: vm-ops
description: Operate the Whoop dashboard VM — SSH access, deploys, systemd service, logs, SQLite DB, nginx + Cloudflare Access. Use whenever the user asks to deploy, restart the web app, pull logs, inspect prod DB, or otherwise touch the production VM.
---

# Whoop dashboard — VM ops

Production lives on an Oracle Cloud VM. Public traffic: DNS → Cloudflare (proxy + Access) → VM port 443 → nginx → `localhost:8501` (Next.js). **No `cloudflared` tunnel** — the box runs nginx directly with a letsencrypt cert. Auth gate is **Cloudflare Access** (302 to `georgnijo.cloudflareaccess.com` for unauthed requests).

## Hosts & users

| Item | Value |
|---|---|
| VM host | `129.80.134.194` |
| Public web domain | `coach.georgenijo.com` (Cloudflare proxy + Access → VM nginx → `localhost:8501`) |
| iOS API domain | `coach-api.georgenijo.com` (Cloudflare proxy, **no** Access — bearer-only → VM nginx → `localhost:8501`) |
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

Runs `next start -p 8501` as `george`, restarts on crash, capped at 512M RAM. nginx (`/etc/nginx/sites-enabled/coach`) listens on 443 with a single letsencrypt cert covering both `coach.georgenijo.com` and `coach-api.georgenijo.com`, and `proxy_pass`es to `localhost:8501`. Cloudflare Access enforces auth at the edge for `coach.*`; `coach-api.*` is bearer-only (no Access).

The unit file is tracked at `systemd/whoop-web.service` in the repo. `infra/terraform/cloud-init.sh` copies it to `/etc/systemd/system/` on fresh VMs via the `*.service` glob, but it does **not** enable the unit and does **not** install its runtime prereqs — see "Fresh VM provisioning" below before bringing up `whoop-web` on a new box.

```bash
sudo systemctl status whoop-web --no-pager | head -10
sudo systemctl restart whoop-web
sudo journalctl -u whoop-web -n 100 --no-pager
sudo journalctl -u whoop-web -f                  # tail live
```

## Cloudflare Access (auth gate)

Public traffic to `coach.georgenijo.com` is gated by **Cloudflare Access**, not by anything in the Next.js app. Unauthenticated requests get `302` to `https://georgnijo.cloudflareaccess.com/...`. Allowed identity: `george.nijo8@gmail.com`.

**Account / app IDs** (account: `George.nijo8@gmail.com's Account`):

| Item | ID |
|---|---|
| account_id | `38cc18a41f7705126a99fbac7cd526ba` |
| zone_id (`georgenijo.com`) | `9d6aac41d48f9da8b5e821dc769c477a` |
| Access app `Coach Dashboard` (gates whole host) | `839d958e-7cec-4062-9ae3-b9f4451b86f9` |
| Access app `Coach Webhook (bypass)` (path `/api/whoop/webhook`) | `1ca713c6-3d3a-4f20-989e-8bdcbdd79cf4` |
| Access app `Coach ACME challenge (bypass)` (path `/.well-known/acme-challenge/`) | `9b6b82f4-9f9c-4cc0-8930-e443872f91a3` |

**Path-scoped bypass pattern.** To exempt a single path from Access, create a SEPARATE self_hosted Access app whose `domain` is the full `host/path` (e.g. `coach.georgenijo.com/api/whoop/webhook`) and attach a single policy with `decision: "bypass"` and `include: [{everyone: {}}]`. CF evaluates the more-specific app first, so that path skips auth while the broader app continues to gate everything else. Used today for the Whoop webhook receiver (issue #27) — the route-level HMAC check is the real auth.

**API token.** Stored in macOS Keychain (service `cloudflare-api-token-whoop`, account `$USER`). `~/.zshrc` exports it as `CLOUDFLARE_API_TOKEN` on shell start. Manual fetch:

```bash
security find-generic-password -a "$USER" -s 'cloudflare-api-token-whoop' -w
```

Token has `Account.Access (Apps + Policies, Edit)`, `Zone.Read`, and `Zone.DNS:Edit` scopes (scoped to `georgenijo.com`). Sufficient for managing Access apps + policies on this account and editing DNS records.

**Useful API recipes:**

```bash
# List all Access apps in the account
ACCT=38cc18a41f7705126a99fbac7cd526ba
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCT/access/apps" \
  | python3 -c "import sys,json; [print(a['id'],'|',a.get('domain','-'),'|',a['name']) for a in json.load(sys.stdin)['result']]"

# Read one app's full policy block
APP=839d958e-7cec-4062-9ae3-b9f4451b86f9
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCT/access/apps/$APP" | python3 -m json.tool

# Verify the gate is intact (root → 302) and bypass works (webhook → reaches origin)
curl -sI https://coach.georgenijo.com/                       # expect: HTTP/2 302
curl -sI https://coach.georgenijo.com/api/whoop/webhook      # expect: HTTP/2 404 (no route yet) or 200
```

If you're locked out of the dashboard from a new device, it's the IdP — log in via the redirected `cloudflareaccess.com` URL with `george.nijo8@gmail.com`.

## Fresh VM provisioning (`whoop-web` only)

`infra/terraform/cloud-init.sh` provisions Python + venv + the Streamlit unit. It does **not** install Node.js, run `npm ci`, or run `npm run build`. The Next.js app and `whoop-web.service` therefore require manual provisioning on any new VM:

```bash
# 1. Install Node.js LTS (Ubuntu 22.04+)
ssh -i ~/.ssh/id_ed25519 ubuntu@<vm-ip> \
  "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo bash - \
   && sudo apt-get install -y nodejs"

# 2. Install deps and build the Next.js app
ssh -i ~/.ssh/id_ed25519 ubuntu@<vm-ip> \
  "sudo -u george bash -c 'cd ~/Documents/whoop-dashboard/apps/web && npm ci && npm run build'"

# 3. Drop .env.local with ANTHROPIC_API_KEY (required for Coach API mode)
ssh -i ~/.ssh/id_ed25519 ubuntu@<vm-ip> \
  "sudo -u george tee /home/george/Documents/whoop-dashboard/apps/web/.env.local <<'EOF'
ANTHROPIC_API_KEY=...
EOF"

# 4. Enable + start the service (cloud-init copies the unit but does not enable it)
ssh -i ~/.ssh/id_ed25519 ubuntu@<vm-ip> \
  "sudo systemctl enable --now whoop-web"
```

If `whoop-web` fails to start (`status` shows `203/EXEC` or `not-found`), the missing piece is almost always one of: `node` not on PATH, `apps/web/node_modules/` empty, or `apps/web/.next/` missing. Re-run steps 1–2 in order.

## Standard deploy flow

From local mac, after committing changes:

**Prerequisite — env-file migration on path-changing deploys.** `apps/web/.env.local` is gitignored, so it never moves when code is reorganized. Any time the working directory of `whoop-web.service` changes (e.g. PR #68 moved `web/` → `apps/web/`), `cp` the file to the new path on the VM **before** building:

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@129.80.134.194 \
  "sudo -u george cp /home/george/Documents/whoop-dashboard/web/.env.local /home/george/Documents/whoop-dashboard/apps/web/.env.local"
```

Skip this and the symptoms are subtle:
- `ANTHROPIC_API_KEY` missing → `/settings` API mode toggle grayed out → Coach silently falls back to CLI mode (~30-60s vs ~2s).
- `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET` missing → Whoop OAuth flow breaks.

```bash
cd /Users/georgenijo/Documents/code/whoop-dashboard \
  && git push \
  && ssh -i ~/.ssh/id_ed25519 ubuntu@129.80.134.194 \
     "sudo -u george bash -c 'cd ~/Documents/whoop-dashboard && git pull && cd apps/web && npm run build' \
      && sudo systemctl restart whoop-web"
```

Build takes ~50s on the VM. After restart, hit `coach.georgenijo.com` to verify — and close any old tabs (see "Browser cache bites hard" gotcha).

## DB inspection

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@129.80.134.194 \
  "sudo -u george sqlite3 /home/george/Documents/whoop-dashboard/shared/whoop_data.db '.tables'"
```

Tables: `recovery`, `sleep`, `cycles`, `workouts`, `body`, `chat_messages`, `chat_logs`, `app_settings`, `sync_logs`. `chat_*`, `app_settings`, and `sync_logs` are created on demand by Next.js (`CREATE TABLE IF NOT EXISTS` in `apps/web/src/lib/db.ts`).

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
- **Browser cache bites hard — close old tabs after deploy.** Each `npm run build` regenerates Next.js chunk hashes (visible in DevTools Network tab — filenames like `0257pdz1-imal.js` change every build). Tabs open before the deploy keep requesting old chunk URLs on dynamic imports → 404s → fallback retries → page feels hiccupy/sluggish even though server TTFB is 100-200ms. Cmd+Shift+R sometimes evicts cleanly but not reliably. **Reliable fix: close the old tab and open a new one.** If reports of "old behavior" come in, suspect cache before code.
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

## Troubleshooting

### SSH times out (TCP connect, not auth)

Symptom: `ssh ubuntu@129.80.134.194` hangs and dies with `connect to address ... port 22: Operation timed out`. `curl https://coach.georgenijo.com` still works (Cloudflare proxy → nginx path is unaffected).

Cause: the Oracle VCN security list allowlists SSH ingress to specific `/32` source IPs only. When your home/ISP IP rotates, your new IP is not in the list and TCP connects to port 22 are silently dropped at the cloud edge. The web app keeps working because port 443 is open to the Cloudflare proxy IP ranges.

Fix:

1. Get your current public IP:
   ```bash
   curl -s https://ifconfig.me
   ```
2. OCI Console → Networking → Virtual Cloud Networks → `dashboards-vcn` → **Security** tab → click `dashboards-sl` → **Ingress Rules** → **Add Ingress Rules**
3. Add: Source CIDR `<your-ip>/32`, IP Protocol TCP, Destination Port `22`, description "SSH home (<location>)"
4. Retry SSH — should connect immediately

Two `/32` slots already exist for known home IPs (Canada + Mass at last check). Stale entries can be deleted, but harmless if left.

Long-term fix to consider: Tailscale/WireGuard mesh, or stand up a Cloudflare Tunnel for SSH (`cloudflared access ssh`) and close port 22 entirely. Either removes the `/32` toil.

### Sync runs slow / insight step takes ~40s

If `daily_sync.py` insight step takes ~40s on a fresh VM, the `streamlit/whoop/insights.py` module is using the legacy `claude` CLI shellout instead of the Anthropic SDK. The fix landed in commit `5096202` (April 2026) — check `head -5 streamlit/whoop/insights.py` shows `import anthropic`, not `import subprocess`. If old code is still on disk, the VM hasn't pulled main.
