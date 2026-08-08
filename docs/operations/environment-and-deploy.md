# Environment and deployment

This is the canonical production runbook. Production runs on Fleet node
`opti`; the retired Oracle host `whoop-vm` is not part of the deploy path.
Never paste secret values into this document, an issue, a pull request, or a
command log.

## Production topology

```text
coach.georgenijo.com ─┐
                      ├─ Cloudflare Tunnel ─> opti:127.0.0.1:8501
coach-api.georgenijo.com ─┘                    │
                                               ├─ Next.js web + API
                                               ├─ Cursor Agent
                                               └─ SQLite (local WAL file)
```

- Fleet name: `opti`. Do not hard-code its Tailscale IP or SSH address.
- Runtime user: `george`, using lingering user-level systemd services.
- Build/runtime Node: NVM `20.20.2` for a stable native-module ABI.
- Public ingress: remotely managed Cloudflare Tunnel; no inbound router ports,
  nginx, LetsEncrypt, or public origin IP.
- GitHub Actions: CI only. Production deploys are operator-triggered through
  `scripts/deploy` after CI succeeds.

## Production filesystem

```text
/home/george/services/whoop-dashboard/
├── current -> releases/<full-git-sha>
├── releases/                    immutable source + built runtime trees
├── shared/whoop_data.db         canonical SQLite database
├── backups/                     verified online SQLite backups
├── runtime-home/                isolated HOME for Cursor runtime state
├── .env.local                   canonical application secrets (mode 0600)
└── cloudflared.token            tunnel connector token (mode 0600)
```

The Git checkout at `/home/george/Documents/code/whoop-dashboard` is only a Git
object store and developer workspace. Deployment uses a temporary detached
worktree and never changes that checkout's active branch or uncommitted files.

## Configuration locations

| Location | Tracked | Purpose |
|---|---:|---|
| `.env.example` | yes | Operator-facing application template |
| `~/services/whoop-dashboard/.env.local` | no | Canonical production application configuration |
| `~/services/whoop-dashboard/cloudflared.token` | no | Cloudflare connector token only |
| `systemd/whoop-web.service` | yes | Rootless Next.js user service |
| `systemd/whoop-cloudflared.service` | yes | Rootless Cloudflare Tunnel user service |

The deploy script symlinks the persistent `.env.local` into each immutable
release. The service explicitly sets `WHOOP_DB_PATH` to the persistent database
outside the release tree.

## Application variables

| Variable | Required when | Consumer |
|---|---|---|
| `WHOOP_CLIENT_ID` | Whoop OAuth or sync is enabled | OAuth and sync |
| `WHOOP_CLIENT_SECRET` | Whoop OAuth or sync is enabled | OAuth and sync |
| `WHOOP_STATE_SECRET` | Connect Whoop is enabled | Signed OAuth state |
| `WHOOP_REDIRECT_URI` | Callback differs from the public default | Whoop OAuth |
| `VAULT_KEY` | Encrypted integrations or BYOK keys are used | Token/key vault |
| `JWT_SIGNING_KEY` | Authenticated web or iOS sessions are used | Session JWTs |
| `ANTHROPIC_API_KEY` | Shared Anthropic fallback is wanted | Coach |
| `CURSOR_API_KEY` | Shared Cursor fallback is wanted | Coach |
| `CURSOR_BACKEND_URL` | Cursor catalog override is needed | Coach settings |
| `PUBLIC_ORIGIN` | Production redirects are generated | Web auth |
| `ADMIN_APPLE_SUB` | Admin webhook replay is enabled | Admin authorization |
| `LOG_LEVEL` | Default logging is not wanted | Structured logger |
| `APPLE_BUNDLE_ID` | Native Sign in with Apple is enabled | iOS identity verification |
| `APPLE_SERVICES_ID` | Web Sign in with Apple is enabled | Web Apple OAuth |
| `APPLE_TEAM_ID` | Web Sign in with Apple is enabled | Web Apple OAuth |
| `APPLE_KEY_ID` | Web Sign in with Apple is enabled | Web Apple OAuth |
| `APPLE_PRIVATE_KEY` | Web Sign in with Apple is enabled | Web Apple OAuth |
| `APPLE_REDIRECT_URI` | Apple callback differs from derived origin | Web Apple OAuth |
| `APNS_KEY_ID` | Push delivery is enabled | APNs |
| `APNS_TEAM_ID` | Push delivery is enabled | APNs |
| `APNS_BUNDLE_ID` | Push delivery is enabled | APNs |
| `APNS_PRIVATE_KEY` | Push delivery is enabled | APNs |
| `APNS_ENVIRONMENT` | Push delivery is enabled | APNs |
| `ENABLE_PUSH_DEBUG` | Temporary push diagnostics are explicitly wanted | Debug route |

`WHOOP_DB_PATH` and `COACH_CURSOR_AGENT_BIN` are set by the tracked systemd
unit. `ENABLE_PUSH_DEBUG` must remain unset or `0` during normal production.

## One-time migration from `whoop-vm`

Do not terminate the Oracle instance until this checklist is complete. The
production database and `.env.local` must be recovered from it once; the small
DB files already present in development worktrees are not production copies.

### 1. Prepare opti

```bash
fleet exec opti "mkdir -p \
  /home/george/services/whoop-dashboard/{releases,shared,backups,runtime-home} \
  && chmod 700 /home/george/services/whoop-dashboard \
    /home/george/services/whoop-dashboard/{backups,runtime-home}"

# NVM is already installed on opti; keep this idempotent.
fleet exec opti "bash -lc 'export NVM_DIR=\$HOME/.nvm; \
  . \$NVM_DIR/nvm.sh; nvm install 20.20.2'"

# User services must survive logout and start after reboot.
fleet exec opti "loginctl show-user george -p Linger"
# If it reports Linger=no:
fleet exec opti "sudo loginctl enable-linger george"

# Review and update both pinned values deliberately when upgrading Cursor.
fleet exec opti "bash -s" <<'CURSOR_INSTALL'
set -euo pipefail
installer=/tmp/cursor-install.sh
expected_sha=a51ebedf2a13bc073d994a6f2defbd1f4d976a6cf116ad678d071c6a363bf3e4
expected_version=2026.07.23-e383d2b
curl -fsSL --output "$installer" https://cursor.com/install
printf '%s  %s\n' "$expected_sha" "$installer" | sha256sum -c -
bash "$installer"
rm -f -- "$installer"
actual=$(/home/george/.local/bin/cursor-agent --version)
[ "$actual" = "$expected_version" ] || {
  echo "cursor-agent version $actual does not match $expected_version" >&2
  exit 1
}
CURSOR_INSTALL
```

Cursor installation reference: <https://docs.cursor.com/en/cli/installation>.

Install `cloudflared` from Cloudflare's current Linux package, then verify the
binary path expected by the service:

```bash
fleet exec opti "bash -s" <<'CLOUDFLARED_INSTALL'
set -euo pipefail
version=2026.7.3
expected_sha=049777d30f9bf93da6df8bbe31383460eb2aa51a832c6551824d56f9fcc55974
package=/tmp/cloudflared-linux-amd64.deb
curl -fsSL --output "$package" \
  "https://github.com/cloudflare/cloudflared/releases/download/$version/cloudflared-linux-amd64.deb"
printf '%s  %s\n' "$expected_sha" "$package" | sha256sum -c -
sudo dpkg -i "$package"
rm -f -- "$package"
/usr/bin/cloudflared --version | grep -F "$version"
CLOUDFLARED_INSTALL
```

Cloudflare installation reference:
<https://developers.cloudflare.com/tunnel/downloads/>.

### 2. Recover the live SQLite database

Bring `whoop-vm` online one final time. Fence writes before the final snapshot
and keep the old web service stopped through cutover; never copy the live WAL
database file directly.

```bash
tailscale ssh ubuntu@whoop-vm \
  'sudo systemctl stop whoop-web && ! sudo systemctl is-active --quiet whoop-web'

tailscale ssh george@whoop-vm "umask 077
rm -f -- /home/george/whoop_data.db.opti-migration
python3 -c '
import sqlite3
s=sqlite3.connect(\"/home/george/Documents/whoop-dashboard/shared/whoop_data.db\", timeout=30)
d=sqlite3.connect(\"/home/george/whoop_data.db.opti-migration\")
s.backup(d)
r=d.execute(\"PRAGMA quick_check\").fetchone()[0]
d.close(); s.close()
raise SystemExit(0 if r == \"ok\" else \"quick_check failed: \" + str(r))
'
chmod 0600 /home/george/whoop_data.db.opti-migration"

tailscale ssh george@whoop-vm \
  'cat /home/george/whoop_data.db.opti-migration' \
  | fleet exec opti \
      "install -m 0600 /dev/stdin /home/george/services/whoop-dashboard/shared/whoop_data.db"
```

Verify the received file without printing user data:

```bash
fleet exec opti "python3 -c '
import sqlite3
p=\"/home/george/services/whoop-dashboard/shared/whoop_data.db\"
c=sqlite3.connect(\"file:\"+p+\"?mode=ro\", uri=True)
assert c.execute(\"PRAGMA quick_check\").fetchone()[0] == \"ok\"
print(\"tables\", c.execute(\"SELECT count(*) FROM sqlite_master WHERE type=\\\"table\\\"\").fetchone()[0])
c.close()
'"

# Remove the temporary Oracle copy only after the destination verifies.
tailscale ssh george@whoop-vm \
  'rm -f -- /home/george/whoop_data.db.opti-migration'
```

### 3. Recover production secrets

Transfer the active file without displaying its contents:

```bash
tailscale ssh george@whoop-vm \
  'cat /home/george/Documents/whoop-dashboard/apps/web/.env.local' \
  | fleet exec opti \
      "install -m 0600 /dev/stdin /home/george/services/whoop-dashboard/.env.local"
```

Review key names only and update origin-dependent values. The public domains do
not change, so Apple and Whoop callback registrations remain valid.

### 4. Create the Cloudflare Tunnel

Before changing DNS, record the existing proxied records for both hostnames so
the Oracle origin can be restored during the migration window. Then, in
Cloudflare Zero Trust:

1. Create a remotely managed tunnel named `whoop-dashboard-opti`.
2. Add public hostname `coach.georgenijo.com` → `http://localhost:8501`.
3. Add public hostname `coach-api.georgenijo.com` → `http://localhost:8501`.
   Replace the old Oracle A/AAAA records if Cloudflare reports a DNS conflict;
   the tunnel hostnames should resolve through the tunnel CNAME, not the old
   public origin.
4. Copy the connector token only into the protected token file:

   ```bash
   fleet exec opti \
     "install -m 0600 /dev/stdin /home/george/services/whoop-dashboard/cloudflared.token"
   ```

   Enter or pipe the token through stdin; do not put it in shell history.

The service uses `cloudflared tunnel run --token-file`, which requires
cloudflared `2025.4.0` or newer. See
<https://developers.cloudflare.com/tunnel/advanced/run-parameters/#token-file>.

### 5. Deploy and cut over

```bash
scripts/deploy --ref <CI-validated-full-sha>
```

Confirm all of the following before deleting the Oracle instance:

```bash
scripts/deploy --check
fleet exec opti "systemctl --user --no-pager status whoop-web whoop-cloudflared"
fleet exec opti "journalctl --user -u whoop-web -u whoop-cloudflared --since '10 min ago' --no-pager"
curl -fsS https://coach-api.georgenijo.com/api/health
curl -fsS -o /dev/null https://coach.georgenijo.com/signin
```

Also sign in on web, open an existing Coach thread, run one Whoop sync, and
send one iOS request. Keep the final Oracle backup offline until at least one
successful opti backup and restore drill has completed.

If cutover fails before `opti` accepts any production write, stop both opti
services before restoring the recorded Oracle DNS records and old service:

```bash
fleet exec opti 'systemctl --user stop whoop-cloudflared whoop-web'
```

If `opti` may have accepted a write, do **not** start Oracle or restore its DNS.
First create a verified online backup from `opti` and reconcile/restore that
newer database onto the stopped Oracle service using the database-restoration
procedure below. At every point exactly one web service may accept writes.

### 6. Retire Oracle

Only after the cutover checks and a restore drill pass:

1. create and retain one final verified online SQLite backup from Oracle;
2. confirm `opti` has the expected user/table counts and newer production
   writes;
3. confirm an `opti` backup restores and passes `PRAGMA quick_check` in a
   temporary file;
4. terminate the Oracle compute instance and deliberately review whether its
   boot volume, reserved public IP, VCN, subnet, gateways, and security lists
   should also be deleted;
5. remove the retired machine from Tailscale/Fleet inventories after recovery
   is no longer needed;
6. retain `infra/terraform/` only as historical evidence and do not apply it.

Oracle deletion is performed in the owning Oracle account after reviewing the
resolved resource list. It is not automated by this repository, because an
unchecked destroy could remove unrelated account resources.

## Normal deployment

After CI passes on the desired commit:

```bash
scripts/deploy --check            # read-only drift/service check
scripts/deploy --ref <CI-validated-full-sha>
```

The script:

1. resolves the exact Git commit locally;
2. acquires the production deploy lock, then uses `fleet exec opti` and an
   isolated detached worktree;
3. runs `npm ci`, build, production prune, native SQLite smoke, and packaged
   Next.js health smoke with Node `20.20.2`;
4. creates a verified SQLite online backup;
5. materializes an immutable release and refreshes the tracked user units;
6. atomically switches `current`, restarts the web service, and verifies the
   exact local build SHA;
7. restarts the tunnel and verifies both public hostnames.

No production secret or database is copied into GitHub, the developer checkout,
or a release directory.

## Operations

```bash
# Compact status
scripts/deploy --check
fleet exec opti "systemctl --user is-active whoop-web whoop-cloudflared"

# Logs
fleet exec opti "journalctl --user -u whoop-web -n 100 --no-pager"
fleet exec opti "journalctl --user -u whoop-cloudflared -n 100 --no-pager"

# Restart
fleet exec opti "systemctl --user restart whoop-web"
fleet exec opti "systemctl --user restart whoop-cloudflared"

# List releases and backups
fleet exec opti "readlink -f ~/services/whoop-dashboard/current; \
  ls -lt ~/services/whoop-dashboard/backups | head"
```

Rollback application code by deploying the previous full SHA:

```bash
scripts/deploy --ref <previous-full-sha>
```

Database restoration is deliberately manual because it discards writes made
after the selected backup. Stop the web service, move the current DB and WAL
sidecars aside, install a verified backup, then start and smoke-test. Never
restore a database file while `whoop-web` is running.

## CI

`.github/workflows/ci.yml` runs `npm ci`, tests, the production build, and a
syntax check of `scripts/deploy` for pull requests and pushes to `main`. CI does
not possess Fleet, Cloudflare, application-secret, or database credentials and
does not deploy production.
