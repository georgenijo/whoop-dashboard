---
name: vm-ops
description: Operate Whoop production on the Optiplex Fleet node opti (legacy skill name) — deploys, user systemd, logs, SQLite, backups, and Cloudflare Tunnel.
---

# Whoop production ops (legacy name)

The directory name is retained for compatibility. There is no active production
VM. Production runtime, secrets, and canonical data live on Fleet node
`opti`; public ingress is an outbound Cloudflare Tunnel.

Read `docs/operations/environment-and-deploy.md` before provisioning,
migrating, rolling back, or deleting the retired Oracle instance.

## Boundaries

- Use `fleet exec opti '<command>'` for normal operations; never use a public
  IP. Access `whoop-vm` only for the documented one-time migration/recovery.
- Use `scripts/deploy` for releases. Do not hand-run Git pulls/builds in the
  production service directory.
- Services are user units. Always use `systemctl --user` and
  `journalctl --user`.
- Never copy a live WAL database directly. Use SQLite's online backup API.
- Do not print or copy `.env.local`, `cloudflared.token`, signing keys, or
  provider tokens into logs, chat, releases, or CI.

## Topology and paths

| Item | Value |
|---|---|
| Fleet node | `opti` |
| Web/API listener | `127.0.0.1:8501` |
| Public ingress | `whoop-cloudflared.service` |
| Service root | `/home/george/services/whoop-dashboard` |
| Current release | `/home/george/services/whoop-dashboard/current` |
| Canonical DB | `/home/george/services/whoop-dashboard/shared/whoop_data.db` |
| Runtime env | `/home/george/services/whoop-dashboard/.env.local` |
| Backups | `/home/george/services/whoop-dashboard/backups` |
| User units | `/home/george/.config/systemd/user` |
| Build checkout | `/home/george/Documents/code/whoop-dashboard` |

## Status and logs

```bash
fleet doctor opti
scripts/deploy --check

fleet exec opti 'systemctl --user status whoop-web whoop-cloudflared --no-pager'
fleet exec opti 'journalctl --user -u whoop-web -n 200 --no-pager'
fleet exec opti 'journalctl --user -u whoop-cloudflared -n 100 --no-pager'
fleet exec opti 'curl -fsS http://127.0.0.1:8501/api/health'
```

For live logs:

```bash
fleet exec opti 'journalctl --user -u whoop-web -f'
```

## Deploy and restart

```bash
scripts/deploy --check
scripts/deploy --ref <CI-validated-full-sha>

fleet exec opti 'systemctl --user restart whoop-web'
fleet exec opti 'systemctl --user restart whoop-cloudflared'
```

The deploy script builds on `opti` with the pinned Node version, validates the
native SQLite runtime, creates an online DB backup, installs an immutable
release, switches `current` atomically, restarts both units, and verifies local
and public health. If activation fails, it restores the prior release symlink.

## Read-only DB inspection

Use Python because it is guaranteed by the deployment contract:

```bash
fleet exec opti "python3 - <<'PY'
import sqlite3
path = '/home/george/services/whoop-dashboard/shared/whoop_data.db'
db = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
print(db.execute('PRAGMA quick_check').fetchone()[0])
print(db.execute('SELECT name FROM sqlite_master WHERE type=\"table\" ORDER BY name').fetchall())
db.close()
PY"
```

For Coach/thread inspection, prefer `scripts/coach`; it performs scoped,
read-only queries through Fleet.

## Manual online backup

Normal deploys back up automatically. For an operator snapshot:

```bash
fleet exec opti "python3 - <<'PY'
import datetime
import pathlib
import sqlite3

root = pathlib.Path('/home/george/services/whoop-dashboard')
stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
target = root / 'backups' / f'whoop_data.db.operator-{stamp}'
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

Use the SHA printed by the last successful deploy:

```bash
scripts/deploy --ref <previous-full-sha>
```

This performs a fresh checked deployment and another pre-activation backup.
Database restoration is a separate, destructive recovery operation; follow the
operations guide and stop the web service before replacing DB files/sidecars.

## Initial migration and retirement

The retired Oracle host is only a recovery source until its production
`whoop_data.db` and `.env.local` are transferred and verified. Do not use the
small repository-local databases as substitutes. Follow the one-time checklist
in `docs/operations/environment-and-deploy.md`, prove web/API/Coach/sync and a
restorable backup on `opti`, then delete the Oracle resources.
