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
| Access control | `coach.georgenijo.com` is gated by Cloudflare Access (george.nijo8@gmail.com) with a path-scoped bypass app for the Whoop webhook; `coach-api.georgenijo.com` stays bearer-only, no Access |
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

Production is currently updated by an operator-run checkout in place at the
app directory, followed by a build and a service restart:

```bash
fleet exec opti 'cd /home/george/Documents/whoop-dashboard && git fetch origin && git status --short'
fleet exec opti 'cd /home/george/Documents/whoop-dashboard && git reset --hard <CI-validated-full-sha>'
# build with the pinned Node runtime, then:
fleet exec opti 'sudo systemctl restart whoop-web'
fleet exec opti 'sudo systemctl restart cloudflared'   # only if the tunnel config changed
```

`scripts/deploy`'s automated immutable-release pipeline
(`releases/`/`current` symlink swap, user-level services, `.env.local`) does
**not** match what is actually deployed on `opti` — that script predates the
manual cutover and has not been reconciled with it. Treat its description as
aspirational until it is updated; verify real state with `sudo systemctl
status` and the checkout's `git log -1`, not the script's assumptions.

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

```bash
fleet exec opti 'cd /home/george/Documents/whoop-dashboard && git reset --hard <previous-full-sha>'
# rebuild, then:
fleet exec opti 'sudo systemctl restart whoop-web'
```

Database restoration is a separate, destructive recovery operation; stop
`whoop-web` before replacing DB files/sidecars, and never restore while the
service is running.

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
