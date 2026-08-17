---
name: vm-ops
description: Operate Whoop production on the Optiplex Fleet node opti (legacy skill name) — deploys, systemd, logs, SQLite, backups, Cloudflare Tunnel, and firewall.
---

# Whoop production ops (legacy name)

The directory name is retained for compatibility. There is no production VM.
Production runtime, secrets, and canonical data live on Fleet node `opti`;
public ingress is a shared, box-level Cloudflare Tunnel (`opti-murmur`,
`dac9359e-51bd-4ad9-8389-dd510127c04e`) that also fronts other services on
the same node (e.g. the Murmur log receiver) — it is not whoop-dashboard's
own tunnel.

Read `docs/operations/environment-and-deploy.md` before provisioning,
redeploying, or touching the retired Oracle archive.

## Boundaries

- Use `fleet exec opti '<command>'` for normal operations; never target a
  public IP. `opti`'s tailnet address (100.82.135.53) is informational only —
  do not hard-code it into scripts or commands.
- `whoop-web` runs as a **system** systemd unit
  (`/etc/systemd/system/whoop-web.service`), not a user unit — operations
  need `sudo` on `opti`. SSH user `george` has passwordless sudo; the old
  two-user privilege-separation dance is gone.
- Never copy a live WAL database directly. Use SQLite's online backup API.
- Do not print or copy `.env`, the JWT signing-key drop-in, cloudflared
  credentials, or provider tokens into logs, chat, releases, or CI.
- The JWT signing key lives in a root-owned, mode-600 systemd drop-in
  (`/etc/systemd/system/whoop-web.service.d/override.conf`) — it is
  deliberately kept out of this repository. Never propose committing it.

## Topology and paths

| Item | Value |
|---|---|
| Fleet node | `opti` (Linux Mint, tailnet `opti`, 100.82.135.53 — informational, don't hard-code) |
| Web/API listener | `127.0.0.1:8501` |
| App / service directory | `/home/george/Documents/whoop-dashboard` |
| Systemd unit | `whoop-web.service` — system unit, requires `sudo systemctl` |
| JWT drop-in | `/etc/systemd/system/whoop-web.service.d/override.conf` (mode 600, not in repo) |
| Node runtime | nvm `v20.20.2` — `/home/george/.nvm/versions/node/v20.20.2/bin/node` |
| Canonical DB | `/home/george/Documents/whoop-dashboard/shared/whoop_data.db` |
| Hardening | `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full` on the unit |
| Public ingress | shared system `cloudflared.service`, config `/etc/cloudflared/config.yml`, tunnel `opti-murmur` (`dac9359e-51bd-4ad9-8389-dd510127c04e`) — no nginx, no certbot, no public IP |
| Access control | In-app only. `apps/web/src/proxy.ts` `authGate()` 307s page requests to `/signin` and returns JSON 401 for API routes, with `requireAuth()` (Bearer → Cookie → 401) behind it. Exempt prefixes: `/signin`, `/api/auth/`, `/api/whoop/webhook`, `/api/admin/`, `/api/health`. **Cloudflare Access was dropped in Phase B-cleanup (PR #332, 2026-05-12)** — there is no Access app, no service token, and no path-scoped bypass in front of either hostname. Widening the exempt list is a policy change and needs a Decisions Log entry. |
| Firewall | `ufw` default-deny; tailnet fully trusted; LAN-scoped allows only for Home Assistant / go2rtc (unrelated to whoop-dashboard, but part of the host's posture) |

## Status and logs

```bash
fleet doctor opti

fleet exec opti 'sudo systemctl status whoop-web cloudflared --no-pager'
fleet exec opti 'sudo journalctl -u whoop-web -n 200 --no-pager'
fleet exec opti 'sudo journalctl -u cloudflared -n 100 --no-pager'
fleet exec opti 'curl -fsS http://127.0.0.1:8501/api/health'
```

For live logs:

```bash
fleet exec opti 'sudo journalctl -u whoop-web -f'
```

## Deploy and restart

Use `scripts/deploy` from a machine with Fleet access. It now matches the
in-place checkout model actually running on `opti` — the old immutable-release
pipeline (`releases/`/`current` symlink swap, user-level services) was removed
when production moved here, so the script and the box agree again.

```bash
scripts/deploy            # deploy origin/main
scripts/deploy --ref <r>  # deploy a specific ref (resolved on opti)
scripts/deploy --check    # report drift only (deployed / serving / target)
```

`--check` is safe to run at any time: it only updates the checkout's
`refs/remotes/origin/main`, runs the Cursor Agent canary in a temp dir, and
prints the deployed sha, `origin/main`, and service state. It does not touch
the working tree, the service, or the database.

A full run guarantees, in order:

- **DB snapshot first** — `sqlite3 -readonly ... VACUUM INTO` into
  `/home/george/whoop-db-backups/` (newest 10 kept), asserted with `PRAGMA
  quick_check` and a table-count comparison against the live DB. Never `cp`:
  the DB is WAL mode with a live writer, so a raw copy can restore as an
  EMPTY database, and a copy straddling a checkpoint can tear it — both
  exit 0.
- **Detached `npm ci` and detached `next build`**, each via `setsid` plus an
  exit-code sentinel polled over fresh connections, so a dropped Fleet
  connection cannot orphan a build holding the lock or leave `node_modules`
  half-populated under the running service (#516, #523). The install step is
  skipped entirely when `package-lock.json` is unchanged.
- **Sha verification** — the deployed commit is compared against what
  `/api/health` actually reports. "The service is up" does not catch a
  restart that kept serving the old bundle.
- **Rollback recipe printed** on success and on any failure after the
  snapshot, covering both the build-level rollback (`.next.prev`) and the DB
  restore. Delete the `-wal`/`-shm` sidecars FIRST when restoring, or a
  leftover WAL replays onto the restored file and blends two database states.

The build-level rollback is **single-step only** — the next deploy overwrites
`.next.prev`.

The equivalent manual sequence, if you need to drive it by hand:

```bash
fleet exec opti 'cd /home/george/Documents/whoop-dashboard && git fetch origin && git status --short'
fleet exec opti 'cd /home/george/Documents/whoop-dashboard && git reset --hard <CI-validated-full-sha>'
# build with the pinned Node runtime, then:
fleet exec opti 'sudo systemctl restart whoop-web'
fleet exec opti 'sudo systemctl restart cloudflared'   # only if the tunnel config changed
```

Verify real state with `sudo systemctl status`, `curl
http://127.0.0.1:8501/api/health`, and the checkout's `git log -1`.

## Read-only DB inspection

Use Python because it is guaranteed by the deployment contract:

```bash
fleet exec opti "python3 - <<'PY'
import sqlite3
path = '/home/george/Documents/whoop-dashboard/shared/whoop_data.db'
db = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
print(db.execute('PRAGMA quick_check').fetchone()[0])
print(db.execute('SELECT name FROM sqlite_master WHERE type=\"table\" ORDER BY name').fetchall())
db.close()
PY"
```

For Coach/thread inspection, prefer `scripts/coach`; it performs scoped,
read-only queries through Fleet.

## Manual online backup

For an operator snapshot:

```bash
fleet exec opti "python3 - <<'PY'
import datetime
import pathlib
import sqlite3

root = pathlib.Path('/home/george/Documents/whoop-dashboard')
stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
target = root / 'shared' / f'whoop_data.db.backup.{stamp}'
source = sqlite3.connect(root / 'shared' / 'whoop_data.db', timeout=30)
destination = sqlite3.connect(target)
source.backup(destination)
result = destination.execute('PRAGMA quick_check').fetchone()[0]
destination.close()
source.close()
if result != 'ok':
    raise SystemExit(f'quick_check failed: {result}')
print(target)
PY"
```

## Rollback

Fastest path, if the previous build is still staged (`scripts/deploy` prints
this on success):

```bash
fleet exec opti 'cd /home/george/Documents/whoop-dashboard/apps/web && rm -rf .next && mv .next.prev .next'
fleet exec opti 'sudo systemctl restart whoop-web'
```

To go back to an older revision and rebuild:

```bash
fleet exec opti 'cd /home/george/Documents/whoop-dashboard && git reset --hard <previous-full-sha>'
# rebuild, then:
fleet exec opti 'sudo systemctl restart whoop-web'
```

Database restoration is a separate, destructive recovery operation. Stop
`whoop-web` first, and **delete the `-wal`/`-shm` sidecars before** copying the
snapshot back — SQLite validates WAL frames by checksum, never by which
database image they belong to, so a leftover `-wal` will replay onto the
restored file and silently blend two states:

```bash
fleet exec opti 'sudo systemctl stop whoop-web'
fleet exec opti 'cd /home/george/Documents/whoop-dashboard/shared \
  && rm -f whoop_data.db-wal whoop_data.db-shm \
  && cp whoop_data.db.backup.<stamp> whoop_data.db'
fleet exec opti 'sudo systemctl start whoop-web'
```

Never restore while the service is running.

## Legacy: whoop-vm (decommissioned)

Production ran on an Oracle Cloud VM (`whoop-vm`, two-user SSH access, nginx +
certbot, public IP) until it was fully migrated to `opti` on 2026-08-10. All
production data, secrets, and traffic now live on `opti`; `whoop-vm`'s
services are stopped and disabled. A final archive of the VM's state
(database, env, configs) is retained at
`opti:/home/george/archives/whoop-vm-2026-08-10/`. The VM itself is powered
off pending termination — do not bring it back online for anything other than
documented, one-time recovery. `infra/terraform/` describes the retired VM
for historical/audit reference only; never `terraform apply` it against
production.
